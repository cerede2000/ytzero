import { randomUUID } from "node:crypto";
import { hostname as systemHostname } from "node:os";
import type { AsyncDatabaseClient } from "./databaseClient";
import { database, databaseConfig } from "./database";
import { backgroundTasksEnabled } from "./deploymentMode";
import { log } from "./logger";
import { COMMIT, VERSION } from "./version";

export const CLUSTER_HEARTBEAT_INTERVAL_MS = 5_000;
export const CLUSTER_ONLINE_WINDOW_MS = 15_000;
export const CLUSTER_HISTORY_WINDOW_MS = 60 * 60_000;
const CLUSTER_CLEANUP_WINDOW_MS = 24 * 60 * 60_000;
const CLUSTER_CLEANUP_INTERVAL_MS = 60 * 60_000;

export interface ClusterInstanceRecord {
  id: string;
  name: string;
  hostname: string;
  started_at_ms: number;
  last_seen_at_ms: number;
  online: boolean;
  version: string;
  commit: string;
  background_tasks: boolean;
  role: "worker" | "http";
  settings: Record<string, string>;
}

export interface ClusterStatus {
  enabled: true;
  generated_at_ms: number;
  current_instance_id: string;
  healthy: boolean;
  summary: { online: number; workers: number; http: number };
  warnings: Array<"no_background_worker" | "multiple_background_workers" | "mixed_versions">;
  instances: ClusterInstanceRecord[];
}

interface ClusterHeartbeat {
  id: string;
  name: string;
  hostname: string;
  startedAtMs: number;
  version: string;
  commit: string;
  backgroundTasks: boolean;
  settings: Record<string, string>;
}

interface ClusterRow {
  instance_id: string;
  instance_name: string;
  hostname: string;
  started_at_ms: number;
  last_seen_at_ms: number;
  version: string;
  commit_hash: string;
  background_tasks: number;
  settings_json: string;
}

function configuredNumber(name: string, fallback: number, minimum = Number.EPSILON, maximum = Number.POSITIVE_INFINITY): string {
  const parsed = Number(process.env[name]);
  return String(Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback);
}

/** Deliberately limited to non-secret operational knobs useful for comparing replicas. */
export function clusterRuntimeSettings(): Record<string, string> {
  return {
    PORT: configuredNumber("PORT", 3001, 1, 65_535),
    YTZERO_BACKGROUND_TASKS: backgroundTasksEnabled() ? "1" : "0",
    APP_EVENT_POLL_INTERVAL_MS: configuredNumber("APP_EVENT_POLL_INTERVAL_MS", 750, 100, 30_000),
    REFRESH_INTERVAL_MINUTES: configuredNumber("REFRESH_INTERVAL_MINUTES", 5),
    FULL_SYNC_INTERVAL_MINUTES: configuredNumber("FULL_SYNC_INTERVAL_MINUTES", 15),
    PLAYLIST_SYNC_INTERVAL_MINUTES: configuredNumber("PLAYLIST_SYNC_INTERVAL_MINUTES", 15),
    POSTS_SYNC_INTERVAL_MINUTES: configuredNumber("POSTS_SYNC_INTERVAL_MINUTES", 10),
    LIVE_INTERVAL_MINUTES: configuredNumber("LIVE_INTERVAL_MINUTES", 3),
    AVATAR_REFRESH_INTERVAL_MINUTES: configuredNumber("AVATAR_REFRESH_INTERVAL_MINUTES", 60),
    AVATAR_REFRESH_BATCH_SIZE: configuredNumber("AVATAR_REFRESH_BATCH_SIZE", 4),
    DURATION_INTERVAL_MINUTES: configuredNumber("DURATION_INTERVAL_MINUTES", 3),
    DURATION_BATCH_SIZE: configuredNumber("DURATION_BATCH_SIZE", 20),
    IMPORT_ENRICH_INTERVAL_MINUTES: configuredNumber("IMPORT_ENRICH_INTERVAL_MINUTES", 2),
    IMPORT_ENRICH_BATCH_SIZE: configuredNumber("IMPORT_ENRICH_BATCH_SIZE", 15),
  };
}

const CLUSTER_RUNTIME_SETTING_KEYS = new Set(Object.keys(clusterRuntimeSettings()));

const startedAtMs = Date.now();
const currentInstanceId = randomUUID();
const currentHostname = systemHostname();
const currentInstanceName = (
  process.env.YTZERO_INSTANCE_NAME?.trim()
  || process.env.NOMAD_ALLOC_NAME?.trim()
  || `${currentHostname}:${clusterRuntimeSettings().PORT}`
).slice(0, 160);

function currentHeartbeat(): ClusterHeartbeat {
  return {
    id: currentInstanceId,
    name: currentInstanceName,
    hostname: currentHostname,
    startedAtMs,
    version: VERSION,
    commit: COMMIT,
    backgroundTasks: backgroundTasksEnabled(),
    settings: clusterRuntimeSettings(),
  };
}

export async function writeClusterHeartbeat(client: AsyncDatabaseClient, heartbeat: ClusterHeartbeat, now = Date.now()): Promise<void> {
  await client.prepare(`
    INSERT INTO cluster_instances (
      instance_id, instance_name, hostname, started_at_ms, last_seen_at_ms,
      version, commit_hash, background_tasks, settings_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(instance_id) DO UPDATE SET
      instance_name=excluded.instance_name,
      hostname=excluded.hostname,
      last_seen_at_ms=excluded.last_seen_at_ms,
      version=excluded.version,
      commit_hash=excluded.commit_hash,
      background_tasks=excluded.background_tasks,
      settings_json=excluded.settings_json
  `).run(
    heartbeat.id,
    heartbeat.name,
    heartbeat.hostname,
    heartbeat.startedAtMs,
    now,
    heartbeat.version,
    heartbeat.commit,
    heartbeat.backgroundTasks ? 1 : 0,
    JSON.stringify(heartbeat.settings),
  );
}

function parseSettings(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => (
      CLUSTER_RUNTIME_SETTING_KEYS.has(entry[0]) && typeof entry[1] === "string"
    )));
  } catch {
    return {};
  }
}

export async function readClusterStatus(
  client: AsyncDatabaseClient,
  instanceId: string,
  now = Date.now(),
): Promise<ClusterStatus> {
  const rows = await client.prepare(`
    SELECT instance_id, instance_name, hostname, started_at_ms, last_seen_at_ms,
           version, commit_hash, background_tasks, settings_json
    FROM cluster_instances
    WHERE last_seen_at_ms >= ?
    ORDER BY last_seen_at_ms DESC, instance_name ASC
  `).all<ClusterRow>(now - CLUSTER_HISTORY_WINDOW_MS);
  const instances = rows.map((row): ClusterInstanceRecord => {
    const backgroundTasks = Number(row.background_tasks) === 1;
    return {
      id: row.instance_id,
      name: row.instance_name,
      hostname: row.hostname,
      started_at_ms: Number(row.started_at_ms),
      last_seen_at_ms: Number(row.last_seen_at_ms),
      online: now - Number(row.last_seen_at_ms) <= CLUSTER_ONLINE_WINDOW_MS,
      version: row.version,
      commit: row.commit_hash,
      background_tasks: backgroundTasks,
      role: backgroundTasks ? "worker" : "http",
      settings: parseSettings(row.settings_json),
    };
  });
  const online = instances.filter((instance) => instance.online);
  const workers = online.filter((instance) => instance.background_tasks).length;
  const warnings: ClusterStatus["warnings"] = [];
  if (workers === 0) warnings.push("no_background_worker");
  if (workers > 1) warnings.push("multiple_background_workers");
  if (new Set(online.map((instance) => `${instance.version}:${instance.commit}`)).size > 1) warnings.push("mixed_versions");
  return {
    enabled: true,
    generated_at_ms: now,
    current_instance_id: instanceId,
    healthy: warnings.length === 0,
    summary: { online: online.length, workers, http: online.length - workers },
    warnings,
    instances,
  };
}

let heartbeatRunning = false;
let lastCleanupAtMs = 0;

async function refreshHeartbeat(): Promise<void> {
  if (heartbeatRunning) return;
  heartbeatRunning = true;
  try {
    const now = Date.now();
    await writeClusterHeartbeat(database, currentHeartbeat(), now);
    if (now - lastCleanupAtMs >= CLUSTER_CLEANUP_INTERVAL_MS) {
      await database.prepare("DELETE FROM cluster_instances WHERE last_seen_at_ms < ?").run(now - CLUSTER_CLEANUP_WINDOW_MS);
      lastCleanupAtMs = now;
    }
  } finally {
    heartbeatRunning = false;
  }
}

export async function startClusterHeartbeat(): Promise<void> {
  if (databaseConfig.engine !== "postgres") return;
  await refreshHeartbeat();
  const timer = setInterval(() => {
    void refreshHeartbeat().catch((error) => log.warn("cluster.heartbeat_failed", {
      error: error instanceof Error ? error.message : String(error),
    }));
  }, CLUSTER_HEARTBEAT_INTERVAL_MS);
  timer.unref();
  log.info("cluster.instance_registered", {
    instanceId: currentInstanceId,
    instanceName: currentInstanceName,
    backgroundTasks: backgroundTasksEnabled(),
  });
}

export async function currentClusterStatus(): Promise<ClusterStatus> {
  await refreshHeartbeat();
  return readClusterStatus(database, currentInstanceId);
}
