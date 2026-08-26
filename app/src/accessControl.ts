import { database } from "./database";
import { getSetting, setSetting } from "./db";
import {
  DEFAULT_RESTRICTED_PERMISSIONS,
  DEFAULT_STANDARD_PERMISSIONS,
  LEGACY_DEFAULT_ADMIN_ONLY_AREAS,
  parseLegacyAdminOnlyAreas,
  PROFILE_PERMISSION_AREAS,
  type PermissionOverride,
  type ProfilePermissionArea,
} from "./profilePermissions";

export interface PermissionGroup {
  id: number;
  portable_uuid: string;
  name: string;
  is_system: boolean;
  permissions: ProfilePermissionArea[];
}

export interface ProfileAccess {
  profile_id: number;
  group_id: number;
  overrides: Partial<Record<ProfilePermissionArea, Exclude<PermissionOverride, "inherit">>>;
  effective: ProfilePermissionArea[];
  admin_only_areas: ProfilePermissionArea[];
}

const all = () => [...PROFILE_PERMISSION_AREAS];
const placeholders = (items: readonly unknown[]) => items.map(() => "?").join(",");

async function createGroup(name: string, permissions: readonly ProfilePermissionArea[], system: boolean) {
  const result = await database.prepare(
    "INSERT INTO permission_groups(portable_uuid,name,is_system) VALUES(?,?,?) RETURNING id,portable_uuid,name,is_system",
  ).get(crypto.randomUUID(), name, system ? 1 : 0) as { id: number; portable_uuid: string; name: string; is_system: number };
  for (const permission of permissions) {
    await database.prepare("INSERT INTO permission_group_permissions(group_id,permission,allowed) VALUES(?,?,1)").run(result.id, permission);
  }
  return result;
}

async function assignProfile(userId: number, groupId: number) {
  await database.prepare("INSERT INTO profile_permission_groups(user_id,group_id) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET group_id=excluded.group_id")
    .run(userId, groupId);
}

/** One-time runtime conversion can safely parse historical JSON, unlike SQL migrations. */
export async function ensureAccessControl(): Promise<void> {
  const existing = await database.prepare("SELECT singleton FROM permission_policy WHERE singleton=1").get() as { singleton: number } | null;
  if (getSetting("access_control_migrated") === "1" && existing) return;
  if (existing) {
    await setSetting("access_control_migrated", "1");
    return;
  }

  const standard = await createGroup("Standard", DEFAULT_STANDARD_PERMISSIONS, true);
  const restricted = await createGroup("Restricted", DEFAULT_RESTRICTED_PERMISSIONS, true);
  await database.prepare("INSERT INTO permission_policy(singleton,default_group_id,revision) VALUES(1,?,1)").run(standard.id);

  const legacy = parseLegacyAdminOnlyAreas(getSetting("profile_admin_only_areas"));
  const isFactoryPolicy = legacy.length === LEGACY_DEFAULT_ADMIN_ONLY_AREAS.length
    && legacy.every((permission) => LEGACY_DEFAULT_ADMIN_ONLY_AREAS.includes(permission));
  let migratedGroupId: number | null = null;
  if (!isFactoryPolicy) {
    const granted = PROFILE_PERMISSION_AREAS.filter((permission) => !legacy.includes(permission));
    migratedGroupId = (await createGroup("Migrated policy", granted, false)).id;
  }

  const users = await database.prepare("SELECT id,is_child FROM users ORDER BY id").all() as Array<{ id: number; is_child: number }>;
  for (const user of users) {
    await assignProfile(user.id, migratedGroupId ?? (user.is_child === 1 ? restricted.id : standard.id));
  }
  await setSetting("access_control_migrated", "1");
}

export async function assignDefaultPermissionGroup(userId: number): Promise<void> {
  const policy = await database.prepare("SELECT default_group_id FROM permission_policy WHERE singleton=1").get() as { default_group_id: number } | null;
  if (!policy) throw new Error("access-control policy is not initialized");
  await assignProfile(userId, policy.default_group_id);
}

export async function effectivePermissions(userId: number, administrator = false): Promise<ProfileAccess> {
  const assignment = await database.prepare("SELECT group_id FROM profile_permission_groups WHERE user_id=?").get(userId) as { group_id: number } | null;
  if (!assignment) await assignDefaultPermissionGroup(userId);
  const groupId = assignment?.group_id ?? (await database.prepare("SELECT group_id FROM profile_permission_groups WHERE user_id=?").get(userId) as { group_id: number }).group_id;
  const grants = await database.prepare("SELECT permission FROM permission_group_permissions WHERE group_id=? AND allowed=1").all(groupId) as Array<{ permission: string }>;
  const overrides = await database.prepare("SELECT permission,allowed FROM profile_permission_overrides WHERE user_id=?").all(userId) as Array<{ permission: string; allowed: number }>;
  const map: Partial<Record<ProfilePermissionArea, Exclude<PermissionOverride, "inherit">>> = {};
  const allowed = new Set<ProfilePermissionArea>(grants.map((row) => row.permission).filter((key): key is ProfilePermissionArea => (PROFILE_PERMISSION_AREAS as readonly string[]).includes(key)));
  for (const row of overrides) {
    if (!(PROFILE_PERMISSION_AREAS as readonly string[]).includes(row.permission)) continue;
    const key = row.permission as ProfilePermissionArea;
    map[key] = row.allowed === 1 ? "allow" : "deny";
    if (row.allowed === 1) allowed.add(key); else allowed.delete(key);
  }
  const effective = administrator ? all() : PROFILE_PERMISSION_AREAS.filter((permission) => allowed.has(permission));
  return { profile_id: userId, group_id: groupId, overrides: map, effective, admin_only_areas: PROFILE_PERMISSION_AREAS.filter((permission) => !effective.includes(permission)) };
}

export async function hasPermission(userId: number, permission: ProfilePermissionArea, administrator = false): Promise<boolean> {
  return administrator || (await effectivePermissions(userId)).effective.includes(permission);
}

export async function accessControlSnapshot() {
  let policy = await database.prepare("SELECT default_group_id,revision FROM permission_policy WHERE singleton=1").get() as { default_group_id: number; revision: number } | null;
  if (!policy) {
    await ensureAccessControl();
    policy = await database.prepare("SELECT default_group_id,revision FROM permission_policy WHERE singleton=1").get() as { default_group_id: number; revision: number } | null;
  }
  if (!policy) throw new Error("access-control policy is not initialized");
  const groups = await database.prepare("SELECT id,portable_uuid,name,is_system FROM permission_groups ORDER BY is_system DESC, name COLLATE NOCASE, id").all() as Array<{ id: number; portable_uuid: string; name: string; is_system: number }>;
  const rows = await database.prepare("SELECT group_id,permission FROM permission_group_permissions WHERE allowed=1").all() as Array<{ group_id: number; permission: string }>;
  return {
    revision: policy.revision,
    default_group_id: policy.default_group_id,
    groups: groups.map((group) => ({ ...group, is_system: group.is_system === 1, permissions: PROFILE_PERMISSION_AREAS.filter((permission) => rows.some((row) => row.group_id === group.id && row.permission === permission)) })),
  };
}

export async function updateGroupPermissions(groupId: number, permissions: readonly ProfilePermissionArea[]) {
  await database.prepare("DELETE FROM permission_group_permissions WHERE group_id=?").run(groupId);
  for (const permission of permissions) await database.prepare("INSERT INTO permission_group_permissions(group_id,permission,allowed) VALUES(?,?,1)").run(groupId, permission);
}

export async function bumpAccessRevision(expectedRevision: number): Promise<boolean> {
  const result = await database.prepare("UPDATE permission_policy SET revision=revision+1 WHERE singleton=1 AND revision=?").run(expectedRevision);
  return Number(result.changes ?? 0) === 1;
}

export async function updateProfileAccess(userId: number, groupId: number, overrides: Partial<Record<ProfilePermissionArea, Exclude<PermissionOverride, "inherit">>>) {
  await assignProfile(userId, groupId);
  await database.prepare("DELETE FROM profile_permission_overrides WHERE user_id=?").run(userId);
  for (const permission of PROFILE_PERMISSION_AREAS) {
    const value = overrides[permission];
    if (value) await database.prepare("INSERT INTO profile_permission_overrides(user_id,permission,allowed) VALUES(?,?,?)").run(userId, permission, value === "allow" ? 1 : 0);
  }
}

export async function groupMemberCount(groupId: number): Promise<number> {
  return Number((await database.prepare("SELECT COUNT(*) AS count FROM profile_permission_groups WHERE group_id=?").get(groupId) as { count: number }).count);
}
