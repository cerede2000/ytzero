import { useEffect, useState } from "react";
import { AlertTriangle, ArchiveRestore, CheckCircle2, Database, LoaderCircle } from "lucide-react";
import { api, type DatabaseStatus } from "../api";
import { useI18n } from "../i18n";
import { Alert, Badge, Button, ButtonLink, Field, Input, SettingRow, Text } from "./ui";
import "./DatabaseSettings.css";

export default function DatabaseSettings({ showToast }: { showToast: (message: string) => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<DatabaseStatus | null>(null);
  const [targetUrl, setTargetUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.databaseStatus().then(setStatus).catch((error) => showToast(error.message));
  useEffect(() => { void load(); }, []);

  const migrate = async () => {
    setBusy(true);
    try {
      const result = await api.migrateDatabaseToPostgres(targetUrl.trim());
      showToast(t("Copied {p0} rows. Set DATABASE_URL and restart.", { p0: result.rows }));
      setTargetUrl("");
      await load();
    } catch (error: any) {
      showToast(error?.message ?? String(error));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const result = await api.confirmDatabaseMigration();
      setStatus(result.status);
      showToast(t("PostgreSQL migration confirmed."));
    } catch (error: any) {
      showToast(error?.message ?? String(error));
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <SettingRow className="database-settings" label={t("Database")}><LoaderCircle className="spin" size={16} /></SettingRow>;

  return (
    <SettingRow
      className="database-settings"
      align="start"
      label={t("Database")}
      description={t("The active database engine and safe migration workflow.")}
    >
      <div className="database-settings__content">
        <div className="database-settings__status">
          <Badge>{status.engine === "sqlite" ? "SQLite" : "PostgreSQL"}</Badge>
          <Text tone="secondary">{status.location}</Text>
        </div>
        {status.state === "unexpected_change" && (
          <Alert variant="danger" title={t("Unexpected database change") }>
            {t("Previously used {p0}. Verify the configuration before writing data.", { p0: status.previousEngine })}
          </Alert>
        )}
        {status.state === "migration_ready" && (
          <Alert variant="success" icon={<CheckCircle2 />} title={t("Migrated database detected") }>
            <div style={{ display: "grid", gap: 8 }}>
              <span>{t("The migration receipt was found. Confirm this PostgreSQL database as active.")}</span>
              <Button variant="primary" onClick={confirm} disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <CheckCircle2 size={15} />}{t("Confirm database")}</Button>
            </div>
          </Alert>
        )}
        {status.engine === "sqlite" && status.state === "current" && (
          <div className="database-settings__migration">
            <Alert variant="warning" icon={<AlertTriangle />} title={t("Create a backup before migrating")}>
              <div className="database-settings__warning-content">
                <span>{t("Migration changes the database backend. Export a current backup before continuing so your portable data can be restored if anything goes wrong.")}</span>
                <ButtonLink size="sm" to="/restore" leadingIcon={<ArchiveRestore size={14} />}>{t("Open backup and restore")}</ButtonLink>
              </div>
            </Alert>
            <Field label={t("PostgreSQL connection URL")} hint={t("The target must be empty. The URL is used only for this migration and is never saved.")}>
              <div className="database-settings__connection">
                <Input type="password" autoComplete="off" value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} placeholder="postgresql://user:password@host/database" />
                <Button variant="primary" onClick={migrate} disabled={busy || !/^postgres(?:ql)?:\/\//i.test(targetUrl.trim())}>{busy ? <LoaderCircle className="spin" size={15} /> : <Database size={15} />}{t("Migrate")}</Button>
              </div>
            </Field>
          </div>
        )}
      </div>
    </SettingRow>
  );
}
