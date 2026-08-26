import { useEffect, useMemo, useState } from "react";
import { api, type AccessControlSnapshot, type ProfilePermissionArea } from "../../api";
import { useI18n, type I18nKey } from "../../i18n";
import { Button, Field, Input, PermissionMatrix, SelectMenu, SettingRow, SettingsSection, Switch, Text } from "../ui";

const OPTIONS: { id: ProfilePermissionArea; key: I18nKey }[] = [
  { id: "channels", key: "profilePermissionChannels" }, { id: "followed_playlists", key: "profilePermissionFollowedPlaylists" },
  { id: "imports", key: "profilePermissionImports" }, { id: "tags", key: "profilePermissionTags" },
  { id: "filters", key: "profilePermissionFilters" }, { id: "playlists", key: "profilePermissionPlaylists" },
  { id: "appearance", key: "profilePermissionAppearance" }, { id: "feed", key: "profilePermissionFeed" },
  { id: "navigation", key: "profilePermissionNavigation" }, { id: "playback", key: "profilePermissionPlayback" },
  { id: "plugins", key: "profilePermissionPlugins" }, { id: "profiles", key: "profilePermissionProfiles" },
];

export default function ProfileAccessSettings({ showToast }: { showToast: (message: string) => void }) {
  const { t } = useI18n();
  const [data, setData] = useState<AccessControlSnapshot | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<number>(0);
  const [newName, setNewName] = useState("");
  const load = () => api.accessControl().then((next) => { setData(next); setSelectedGroup((current) => current || next.default_group_id); }).catch((error) => showToast(`${t("error")}: ${error.message}`));
  useEffect(() => { void load(); }, []);
  const group = data?.groups.find((item) => item.id === selectedGroup);
  const columns = useMemo(() => OPTIONS.map((item) => ({ id: item.id, label: t(item.key) })), [t]);
  if (!data || !group) return null;
  const saveGroup = async (permission: ProfilePermissionArea, allowed: boolean) => {
    const permissions = allowed ? [...new Set([...group.permissions, permission])] : group.permissions.filter((item) => item !== permission);
    try { setData(await api.updatePermissionGroup(group.id, permissions)); } catch (error) { showToast(`${t("error")}: ${error instanceof Error ? error.message : error}`); }
  };
  return <>
    <SettingsSection title={t("profilePermissionsTitle")} description={t("profilePermissionsHint")}>
      <SettingRow label={t("profile")}>
        <SelectMenu value={data.default_group_id} label={t("profile")} options={data.groups.map((item) => ({ value: item.id, label: item.name }))} onChange={async (id) => { try { setData(await api.setDefaultPermissionGroup(id)); } catch (error) { showToast(`${t("error")}: ${error instanceof Error ? error.message : error}`); } }} />
      </SettingRow>
      <Field label={t("name")}><div className="form-row"><Input value={newName} onChange={(event) => setNewName(event.target.value)} /><Button onClick={async () => { if (!newName.trim()) return; try { const next = await api.createPermissionGroup(newName.trim(), []); setData(next); setNewName(""); } catch (error) { showToast(`${t("error")}: ${error instanceof Error ? error.message : error}`); } }}>{t("create")}</Button></div></Field>
      <SettingRow label={t("profiles")}><SelectMenu value={group.id} label={t("profiles")} options={data.groups.map((item) => ({ value: item.id, label: item.name }))} onChange={setSelectedGroup} /></SettingRow>
      {OPTIONS.map((option) => <SettingRow key={option.id} label={t(option.key)}><Switch ariaLabel={t(option.key)} checked={group.permissions.includes(option.id)} onCheckedChange={(checked) => void saveGroup(option.id, checked)} /></SettingRow>)}
    </SettingsSection>
    <SettingsSection title={t("profilePermissionsTitle")} description={t("profilePermissionsHint")}>
      <PermissionMatrix
        rows={data.profiles} columns={columns} rowHeader={t("profile")}
        stateLabels={{ inherit: t("profile"), allow: t("yes"), deny: t("error") }}
        renderRow={(profile) => <><strong>{profile.name}</strong>{profile.is_admin && <Text tone="secondary"> {t("profileAdministrator")}</Text>}<SelectMenu value={profile.access.group_id} label={t("profiles")} options={data.groups.map((item) => ({ value: item.id, label: item.name }))} onChange={async (groupId) => { try { await api.updateProfileAccess(profile.id, groupId, profile.access.overrides); load(); } catch (error) { showToast(`${t("error")}: ${error instanceof Error ? error.message : error}`); } }} /></>}
        valueFor={(profile, key) => profile.access.overrides[key as ProfilePermissionArea] ?? "inherit"}
        onChange={(profile, key, value) => { const overrides = { ...profile.access.overrides }; if (value === "inherit") delete overrides[key as ProfilePermissionArea]; else overrides[key as ProfilePermissionArea] = value; void api.updateProfileAccess(profile.id, profile.access.group_id, overrides).then(load).catch((error) => showToast(`${t("error")}: ${error.message}`)); }}
      />
    </SettingsSection>
  </>;
}
