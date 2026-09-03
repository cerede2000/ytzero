import { afterEach, describe, expect, test } from "bun:test";
import { AsyncDatabaseClient } from "./databaseClient";
import { clusterRuntimeSettings, readClusterStatus, writeClusterHeartbeat } from "./clusterRuntime";

const clients: AsyncDatabaseClient[] = [];

async function testDatabase(): Promise<AsyncDatabaseClient> {
  const client = new AsyncDatabaseClient("sqlite", ":memory:");
  clients.push(client);
  await client.exec(`
    CREATE TABLE cluster_instances (
      instance_id TEXT PRIMARY KEY, instance_name TEXT NOT NULL, hostname TEXT NOT NULL,
      started_at_ms INTEGER NOT NULL, last_seen_at_ms INTEGER NOT NULL,
      version TEXT NOT NULL, commit_hash TEXT NOT NULL, background_tasks INTEGER NOT NULL,
      settings_json TEXT NOT NULL
    )
  `);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("cluster runtime status", () => {
  test("publishes only the explicit non-secret runtime allowlist", () => {
    const settings = clusterRuntimeSettings();
    expect(settings.YTZERO_BACKGROUND_TASKS).toMatch(/^[01]$/);
    for (const forbidden of ["DATABASE_URL", "PASSWORD", "TOKEN", "COOKIE", "SECRET", "PATH"]) {
      expect(Object.keys(settings).some((key) => key.includes(forbidden))).toBe(false);
    }
  });

  test("reports one worker and one HTTP replica as healthy", async () => {
    const client = await testDatabase();
    const now = 2_000_000;
    await writeClusterHeartbeat(client, {
      id: "worker", name: "worker-1", hostname: "node-a", startedAtMs: 1_000_000,
      version: "2026.09.1", commit: "abcdef0", backgroundTasks: true,
      settings: { YTZERO_BACKGROUND_TASKS: "1", DATABASE_URL: "postgresql://secret" },
    }, now);
    await writeClusterHeartbeat(client, {
      id: "http", name: "http-1", hostname: "node-b", startedAtMs: 1_500_000,
      version: "2026.09.1", commit: "abcdef0", backgroundTasks: false,
      settings: { YTZERO_BACKGROUND_TASKS: "0" },
    }, now);

    const status = await readClusterStatus(client, "http", now + 1_000);
    expect(status.healthy).toBe(true);
    expect(status.summary).toEqual({ online: 2, workers: 1, http: 1 });
    expect(status.instances.find((instance) => instance.id === "http")?.settings).toEqual({ YTZERO_BACKGROUND_TASKS: "0" });
    expect(status.instances.find((instance) => instance.id === "worker")?.settings.DATABASE_URL).toBeUndefined();
  });

  test("warns about conflicting workers and versions but excludes stale nodes from health", async () => {
    const client = await testDatabase();
    const now = 2_000_000;
    for (const [id, version, seen] of [["a", "1", now], ["b", "2", now], ["stale", "3", now - 20_000]] as const) {
      await writeClusterHeartbeat(client, {
        id, name: id, hostname: id, startedAtMs: 1_000_000,
        version, commit: "abcdef0", backgroundTasks: true, settings: {},
      }, seen);
    }
    const status = await readClusterStatus(client, "a", now);
    expect(status.warnings).toEqual(["multiple_background_workers", "mixed_versions"]);
    expect(status.summary.workers).toBe(2);
    expect(status.instances.find((instance) => instance.id === "stale")?.online).toBe(false);
  });
});
