import { describe, expect, test } from "bun:test";
import { AsyncDatabaseClient } from "./databaseClient";
import { applyDatabaseMigrations, DATABASE_MIGRATIONS } from "./databaseMigrations";

describe("cross-database schema migrations", () => {
  test("requires an implementation for SQLite and PostgreSQL", () => {
    for (const migration of DATABASE_MIGRATIONS) {
      expect(migration.sqlite.length).toBeGreaterThan(0);
      expect(migration.postgres.length).toBeGreaterThan(0);
    }
  });

  test("uses text-compatible timestamp defaults in PostgreSQL migrations", () => {
    for (const migration of DATABASE_MIGRATIONS) {
      for (const step of migration.postgres) {
        if (step.kind === "sql") expect(step.statement).not.toMatch(/TEXT\s+(?:NOT\s+NULL\s+)?DEFAULT\s+CURRENT_TIMESTAMP/i);
      }
    }
  });

  test("upgrades an old SQLite schema once", async () => {
    const database = new AsyncDatabaseClient("sqlite", ":memory:");
    await database.exec("CREATE TABLE users (id INTEGER PRIMARY KEY)");
    await database.exec("CREATE TABLE user_channels (user_id INTEGER, channel_id TEXT)");
    await database.exec("CREATE TABLE user_videos (user_id INTEGER, video_id TEXT)");
    await database.exec("CREATE TABLE user_playlist_videos (playlist_id INTEGER, video_id TEXT, added_at TEXT)");
    await database.exec("CREATE TABLE videos (video_id TEXT PRIMARY KEY)");
    await database.exec("INSERT INTO user_playlist_videos VALUES (1, 'later', '2026-01-02'), (1, 'earlier', '2026-01-01')");

    expect(await applyDatabaseMigrations(database)).toBe(104);
    expect(await applyDatabaseMigrations(database)).toBe(104);
    expect((await database.prepare("PRAGMA table_info(auth_sessions)").all() as Array<{ name: string }>).some((column) => column.name === "permission_group_uuid")).toBe(true);

    const columns = await database.prepare('PRAGMA table_info("user_channels")').all<{ name: string }>();
    expect(columns.some((column) => column.name === "shorts_feed_visibility")).toBe(true);
    const videoColumns = await database.prepare('PRAGMA table_info("user_videos")').all<{ name: string }>();
    expect(videoColumns.some((column) => column.name === "playback_context_json")).toBe(true);
    const catalogColumns = await database.prepare('PRAGMA table_info("videos")').all<{ name: string }>();
    expect(catalogColumns.some((column) => column.name === "is_unavailable")).toBe(true);
    expect(catalogColumns.some((column) => column.name === "availability_checked_at")).toBe(true);
    expect(catalogColumns.some((column) => column.name === "short_check_attempts")).toBe(true);
    expect(catalogColumns.some((column) => column.name === "short_check_attempted_at")).toBe(true);
    expect(catalogColumns.some((column) => column.name === "short_check_next_attempt_at")).toBe(true);
    expect(await database.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='index' AND name='idx_videos_shorts_retry'").get<{ present: number }>())
      .toEqual({ present: 1 });
    expect(await database.prepare("SELECT video_id, position FROM user_playlist_videos ORDER BY position").all())
      .toEqual([{ video_id: "earlier", position: 0 }, { video_id: "later", position: 1 }]);
    expect(await database.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 2").get<{ count: number }>())
      .toEqual({ count: 1 });
    expect(await database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='tube_archivist_items'").get<{ count: number }>())
      .toEqual({ count: 1 });
    for (const table of ["permission_groups", "permission_group_permissions", "profile_permission_groups", "profile_permission_overrides", "permission_policy"]) {
      expect(await database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?").get<{ count: number }>(table))
        .toEqual({ count: 1 });
    }
    const permissionGroupColumns = await database.prepare('PRAGMA table_info("permission_groups")').all<{ name: string }>();
    expect(permissionGroupColumns.some((column) => column.name === "sort_order")).toBe(true);
    await database.close();
  });
});
