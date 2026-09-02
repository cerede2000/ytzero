import { getSetting, setSetting } from "./db";

export interface ExternalRoleMapping {
  group: string;
  role_uuid: string;
}

export interface ExternalRoleMappingConfig {
  mappings: ExternalRoleMapping[];
  fallback_role_uuid: string | null;
}

const EMPTY_CONFIG: ExternalRoleMappingConfig = { mappings: [], fallback_role_uuid: null };

export function parseExternalRoleMappingConfig(raw: string | null | undefined): ExternalRoleMappingConfig {
  if (!raw) return EMPTY_CONFIG;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY_CONFIG;
    const mappings = Array.isArray(value.mappings)
      ? (value.mappings as unknown[])
          .filter((item: unknown): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
          .map((item) => ({ group: String(item.group ?? "").trim(), role_uuid: String(item.role_uuid ?? "").trim() }))
          .filter((item) => item.group && item.role_uuid)
      : [];
    const fallback = typeof value.fallback_role_uuid === "string" ? value.fallback_role_uuid.trim() : "";
    return { mappings, fallback_role_uuid: fallback || null };
  } catch {
    return EMPTY_CONFIG;
  }
}

export function externalRoleMappingConfig(settingKey: "auth_oidc_role_mappings" | "auth_proxy_role_mappings") {
  return parseExternalRoleMappingConfig(getSetting(settingKey));
}

export function matchedExternalRoleUuid(config: ExternalRoleMappingConfig, groups: readonly string[]): string | null {
  const available = new Set(groups.map((group) => group.trim()).filter(Boolean));
  return config.mappings.find((mapping) => available.has(mapping.group))?.role_uuid ?? config.fallback_role_uuid;
}

export function normalizeExternalGroups(value: unknown): string[] {
  if (Array.isArray(value)) return [...new Set(value.map(String).map((group) => group.trim()).filter(Boolean))];
  if (typeof value === "string") return [...new Set(value.split(",").map((group) => group.trim()).filter(Boolean))];
  return [];
}

export async function removeRoleFromExternalMappings(roleUuid: string): Promise<void> {
  for (const key of ["auth_oidc_role_mappings", "auth_proxy_role_mappings"] as const) {
    const current = externalRoleMappingConfig(key);
    const next: ExternalRoleMappingConfig = {
      mappings: current.mappings.filter((mapping) => mapping.role_uuid !== roleUuid),
      fallback_role_uuid: current.fallback_role_uuid === roleUuid ? null : current.fallback_role_uuid,
    };
    if (next.mappings.length !== current.mappings.length || next.fallback_role_uuid !== current.fallback_role_uuid) {
      await setSetting(key, JSON.stringify(next));
    }
  }
}
