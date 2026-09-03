import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Cpu, Globe2, LoaderCircle, Network, RefreshCw, ServerCog, ServerOff } from "lucide-react";
import { api, type ClusterStatus } from "../../api";
import { formatTimeAgo, useI18n, type I18nKey } from "../../i18n";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  FormActions,
  RevealList,
  SettingsSection,
} from "../ui";
import "./ClusterSettings.css";

const REFRESH_INTERVAL_MS = 5_000;

function warningText(warning: ClusterStatus["warnings"][number], t: ReturnType<typeof useI18n>["t"]): string {
  if (warning === "no_background_worker") return t("clusterWarningNoWorker");
  if (warning === "multiple_background_workers") return t("clusterWarningMultipleWorkers");
  return t("clusterWarningMixedVersions");
}

const SETTING_LABELS: Record<string, I18nKey> = {
  PORT: "clusterSettingPort",
  APP_EVENT_POLL_INTERVAL_MS: "clusterSettingEvents",
  REFRESH_INTERVAL_MINUTES: "clusterSettingFeed",
  FULL_SYNC_INTERVAL_MINUTES: "clusterSettingChannels",
  PLAYLIST_SYNC_INTERVAL_MINUTES: "clusterSettingPlaylists",
  POSTS_SYNC_INTERVAL_MINUTES: "clusterSettingPosts",
  LIVE_INTERVAL_MINUTES: "clusterSettingLive",
  AVATAR_REFRESH_INTERVAL_MINUTES: "clusterSettingAvatars",
  DURATION_INTERVAL_MINUTES: "clusterSettingMetadata",
  IMPORT_ENRICH_INTERVAL_MINUTES: "clusterSettingImports",
};

function readableSettings(settings: Record<string, string>, t: ReturnType<typeof useI18n>["t"]) {
  return Object.entries(SETTING_LABELS).flatMap(([key, label]) => {
    const value = settings[key];
    if (value == null) return [];
    const suffix = key === "PORT" ? "" : key.endsWith("_MS") ? " ms" : " min";
    const batchKey = key === "AVATAR_REFRESH_INTERVAL_MINUTES" ? "AVATAR_REFRESH_BATCH_SIZE"
      : key === "DURATION_INTERVAL_MINUTES" ? "DURATION_BATCH_SIZE"
      : key === "IMPORT_ENRICH_INTERVAL_MINUTES" ? "IMPORT_ENRICH_BATCH_SIZE"
      : null;
    const batch = batchKey ? settings[batchKey] : null;
    return [{ key, label: t(label), value: `${value}${suffix}${batch ? ` · ${batch}×` : ""}` }];
  });
}

export function ClusterSettings() {
  const { t, language } = useI18n();
  const [status, setStatus] = useState<ClusterStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      setStatus(await api.clusterStatus());
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  if (loading && !status) {
    return <SettingsSection title={t("clusterTitle")} description={t("clusterDescription")}>
      <EmptyState compact icon={<LoaderCircle className="spin" />} title={t("clusterLoading")} />
    </SettingsSection>;
  }

  if (!status) {
    return <SettingsSection title={t("clusterTitle")} description={t("clusterDescription")}>
      <Alert variant="danger" title={t("clusterLoadError")}>{error}</Alert>
      <FormActions><Button onClick={() => void load(true)} leadingIcon={<RefreshCw size={16} />}>{t("reload")}</Button></FormActions>
    </SettingsSection>;
  }

  return <>
    <SettingsSection title={t("clusterTitle")} description={t("clusterDescription")} className="cluster-dashboard">
      <div className="cluster-overview">
        <Badge variant={status.healthy ? "success" : "warning"} className="cluster-overview__health">
          {status.healthy ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          {status.healthy ? t("clusterHealthy") : t("clusterNeedsAttention")}
        </Badge>
        <Button size="sm" onClick={() => void load(true)} disabled={refreshing} leadingIcon={refreshing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}>
          {t("clusterRefresh")}
        </Button>
      </div>
      {error && <Alert variant="warning" title={t("clusterRefreshFailed")}>{error}</Alert>}
      {status.warnings.map((warning) => <Alert key={warning} variant="warning" icon={<AlertTriangle size={17} />}>
        {warningText(warning, t)}
      </Alert>)}
      <div className="cluster-stats">
        <div className="cluster-stat cluster-stat--online"><div className="cluster-stat__icon"><Activity /></div><strong>{status.summary.online}</strong><span>{t("clusterOnlineNodes")}</span></div>
        <div className="cluster-stat cluster-stat--worker"><div className="cluster-stat__icon"><Cpu /></div><strong>{status.summary.workers}</strong><span>{t("clusterWorkerNodes")}</span></div>
        <div className="cluster-stat cluster-stat--http"><div className="cluster-stat__icon"><Globe2 /></div><strong>{status.summary.http}</strong><span>{t("clusterHttpNodes")}</span></div>
      </div>
      <div className="cluster-auto-refresh">{t("clusterAutoRefresh")}</div>
    </SettingsSection>

    {status.instances.length === 0 ? <SettingsSection>
      <EmptyState icon={<Network />} title={t("clusterNoInstances")} description={t("clusterNoInstancesHint")} />
    </SettingsSection> : <SettingsSection title={t("clusterNodes")} className="cluster-nodes-section">
      <div className="cluster-node-grid">
        {status.instances.map((instance) => {
          const isCurrent = instance.id === status.current_instance_id;
          const settings = readableSettings(instance.settings, t);
          const NodeIcon = !instance.online ? ServerOff : instance.background_tasks ? ServerCog : Globe2;
          return <article key={instance.id} className={`cluster-node-card cluster-node-card--${!instance.online ? "offline" : instance.background_tasks ? "worker" : "http"}`}>
            <header className="cluster-node-card__header">
              <div className="cluster-node-card__icon"><NodeIcon /></div>
              <div className="cluster-node-card__identity">
                <div className="cluster-node-card__name">{instance.name}</div>
                <div className="cluster-node-card__host">{instance.hostname}</div>
              </div>
              <span className="cluster-node-card__status" title={instance.online ? t("clusterOnline") : t("clusterOffline")}><i /></span>
            </header>
            <div className="cluster-node-card__badges">
              <Badge size="sm" variant={instance.background_tasks ? "accent" : "neutral"}>{instance.background_tasks ? t("clusterWorkerRole") : t("clusterHttpRole")}</Badge>
              {isCurrent && <Badge size="sm" variant="success">{t("clusterCurrentNode")}</Badge>}
            </div>
            <div className="cluster-node-card__meta">
              <div><span>{t("clusterVersion")}</span><strong>{instance.version}</strong><code>{instance.commit}</code></div>
              <div><span>{t("clusterStarted")}</span><strong>{formatTimeAgo(new Date(instance.started_at_ms).toISOString(), language)}</strong></div>
              <div><span>{t("clusterLastSeen")}</span><strong>{formatTimeAgo(new Date(instance.last_seen_at_ms).toISOString(), language)}</strong></div>
            </div>
            <RevealList
              items={settings}
              previewCount={4}
              showMore={t("showMore")}
              showLess={t("showLess")}
              listClassName="cluster-settings-list"
              renderRow={(setting) => <div className="cluster-setting" key={setting.key}>
                <span>{setting.label}</span><strong>{setting.value}</strong>
              </div>}
            />
          </article>;
        })}
      </div>
    </SettingsSection>}
  </>;
}
