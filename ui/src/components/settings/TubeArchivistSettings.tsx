import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { tubeArchivistApi, type TubeArchivistStatus } from "../../tubeArchivistApi";
import { Alert, Button, Field, FormActions, Input, SettingRow, SettingsSection } from "../ui";

export function TubeArchivistSettings({ canManage }: { canManage: boolean }) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<TubeArchivistStatus | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | "sync" | "clear" | null>(null);

  const reload = async () => {
    const next = await tubeArchivistApi.config();
    setStatus(next);
    setBaseUrl(next.baseUrl);
  };
  useEffect(() => { void reload().catch((error) => setMessage(error instanceof Error ? error.message : String(error))); }, []);

  const run = async (kind: "save" | "test" | "sync" | "clear") => {
    setBusy(kind); setMessage(null);
    try {
      if (kind === "save") {
        const next = await tubeArchivistApi.updateConfig({ baseUrl, ...(token.trim() ? { token } : {}) });
        setStatus(next); setToken("");
        setMessage(t("Configuration saved."));
      } else if (kind === "clear") {
        const next = await tubeArchivistApi.updateConfig({ clearToken: true });
        setStatus(next); setToken("");
        setMessage(t("Token removed."));
      } else if (kind === "test") {
        const result = await tubeArchivistApi.test();
        setMessage(`${t("Connection works")}${result.version ? ` — TubeArchivist ${result.version}` : "."}`);
      } else {
        const result = await tubeArchivistApi.sync();
        await reload();
        setMessage(t("Imported {count} videos.", { count: result.imported }));
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(null); }
  };

  return <SettingsSection
    title={t("TubeArchivist connection")}
    description={t("The library appears automatically in the existing feed; the plugin does not add a separate page.")}
  >
    {message && <Alert variant="info">{message}</Alert>}
    <SettingRow label={t("Server URL")} description="http(s)://host:port">
      <Field>
        <Input aria-label={t("TubeArchivist URL")} type="url" value={baseUrl} disabled={!canManage || busy !== null} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://tubearchivist:8000" />
      </Field>
    </SettingRow>
    <SettingRow label={t("TubeArchivist API token")} description={status?.tokenConfigured ? t("A token is configured. Leaving this blank preserves it.") : t("No token is configured yet.")}>
      <Field>
        <Input aria-label={t("TubeArchivist API token")} type="password" value={token} disabled={!canManage || busy !== null} onChange={(event) => setToken(event.target.value)} autoComplete="new-password" />
      </Field>
    </SettingRow>
    {status?.configured && <Alert variant={status.lastError ? "warning" : "info"}>
      {t("Local videos")}: {status.itemCount}
      {status.lastSyncedAt ? ` · ${t("last sync")}: ${new Date(status.lastSyncedAt).toLocaleString(locale)}` : ""}
      {status.lastError ? ` · ${status.lastError}` : ""}
    </Alert>}
    <FormActions>
      {status?.tokenConfigured && <Button variant="danger" disabled={!canManage || busy !== null} onClick={() => void run("clear")}>{busy === "clear" ? "…" : t("Remove token")}</Button>}
      <Button disabled={!canManage || busy !== null || !status?.configured} onClick={() => void run("test")}>{busy === "test" ? "…" : t("Test connection")}</Button>
      <Button disabled={!canManage || busy !== null || !status?.configured} onClick={() => void run("sync")}>{busy === "sync" ? "…" : t("Sync now")}</Button>
      <Button variant="primary" disabled={!canManage || busy !== null || !baseUrl.trim()} onClick={() => void run("save")}>{busy === "save" ? "…" : t("save")}</Button>
    </FormActions>
  </SettingsSection>;
}
