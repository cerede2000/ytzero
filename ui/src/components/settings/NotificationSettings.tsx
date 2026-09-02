import { useCallback, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { api, type NotificationCategory, type NotificationPreferences } from "../../api";
import { useI18n, type I18nKey } from "../../i18n";
import { Alert, Button, SettingRow, SettingsSection, Switch } from "../ui";
import "./NotificationSettings.css";

const CATEGORY_ROWS: Array<{ kind: NotificationCategory; label: I18nKey; description: I18nKey }> = [
  { kind: "channel_video", label: "notificationChannelUploads", description: "notificationChannelUploadsHint" },
  { kind: "playlist_video", label: "notificationPlaylistUpdates", description: "notificationPlaylistUpdatesHint" },
  { kind: "download_failed", label: "notificationDownloadFailures", description: "notificationDownloadFailuresHint" },
  { kind: "social", label: "notificationSocialActivity", description: "notificationSocialActivityHint" },
  { kind: "app_update", label: "notificationAppUpdates", description: "notificationAppUpdatesHint" },
];

export default function NotificationSettings() {
  const { t } = useI18n();
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState("");

  const load = useCallback(async () => {
    try { setPreferences(await api.notificationPreferences()); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const updateProfile = async (input: Parameters<typeof api.updateNotificationPreferences>[0], key: string) => {
    if (!preferences || pending) return;
    setPending(key);
    const previous = preferences;
    setPreferences({
      ...preferences,
      enabled: input.enabled ?? preferences.enabled,
      categories: { ...preferences.categories, ...input.categories },
    });
    try { await api.updateNotificationPreferences(input); setError(""); }
    catch (reason) { setPreferences(previous); setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPending(""); }
  };

  if (!preferences && !error) return <SettingsSection><div className="notification-settings__loading"><LoaderCircle className="spin" />{t("loading")}</div></SettingsSection>;

  return <div className="notification-settings">
    {error && <Alert variant="danger" title={t("error")}>{error}{!preferences && <div><Button size="sm" onClick={() => void load()}>{t("reload")}</Button></div>}</Alert>}
    {preferences && <>
      <SettingsSection title={t("notificationProfileControl")} description={t("notificationProfileControlHint")}>
        <SettingRow label={t("notificationMasterSwitch")} description={t("notificationMasterSwitchHint")}>
          <Switch checked={preferences.enabled} disabled={pending === "master"} onCheckedChange={(enabled) => void updateProfile({ enabled }, "master")} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t("notificationCategories")} description={t("notificationCategoriesHint")}>
        {CATEGORY_ROWS.map((category) => <SettingRow key={category.kind} label={t(category.label)} description={t(category.description)}>
          <Switch checked={preferences.categories[category.kind]} disabled={Boolean(pending)} onCheckedChange={(enabled) => void updateProfile({ categories: { [category.kind]: enabled } }, category.kind)} />
        </SettingRow>)}
      </SettingsSection>

    </>}
  </div>;
}
