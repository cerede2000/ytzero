import type { AsyncDatabaseClient } from "./databaseClient";
import type { DatabaseEngine } from "./databaseConfig";
import type { CanonicalSchemaFile } from "./canonicalSchema";

export { CANONICAL_SCHEMA_FILES } from "./canonicalSchema";

interface AddColumnStep {
  kind: "add-column";
  table: string;
  column: string;
  definition: string;
}

interface SqlStep {
  kind: "sql";
  statement: string;
}

interface NoopStep {
  kind: "noop";
  reason: string;
}

export type DatabaseMigrationStep = AddColumnStep | SqlStep | NoopStep;

export interface DatabaseMigration {
  version: number;
  name: string;
  schemaHashes: Partial<Record<CanonicalSchemaFile, string>>;
  sqlite: readonly DatabaseMigrationStep[];
  postgres: readonly DatabaseMigrationStep[];
}

// Version 1 belongs to the older SQLite-only migration runner. Every migration
// from version 2 onward must explicitly support both database engines. The
// repository check enforces the two implementations and schema fingerprints.
export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  {
    version: 2,
    name: "postgres-compatibility-columns",
    schemaHashes: {
      "app/src/schema.sql": "76d5ac28c9619f64bf85c9928c1c4e43a8f34069aae9c789e5f12eba8d8c08dd",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
    },
    sqlite: [
      { kind: "add-column", table: "users", column: "is_admin", definition: "INTEGER NOT NULL DEFAULT 0" },
      { kind: "add-column", table: "user_channels", column: "shorts_feed_visibility", definition: "TEXT" },
    ],
    postgres: [
      { kind: "add-column", table: "users", column: "is_admin", definition: "INTEGER NOT NULL DEFAULT 0" },
      { kind: "add-column", table: "user_channels", column: "shorts_feed_visibility", definition: "TEXT" },
    ],
  },
  {
    version: 3,
    name: "resume-playback-context",
    schemaHashes: {
      "app/src/schema.sql": "a0e8fea9bc340532d0f77b0879eb07207efe2daa6ef5f67366cd6242d6367dcd",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
    },
    sqlite: [
      { kind: "add-column", table: "user_videos", column: "playback_context_json", definition: "TEXT" },
    ],
    postgres: [
      { kind: "add-column", table: "user_videos", column: "playback_context_json", definition: "TEXT" },
    ],
  },
  {
    version: 4,
    name: "personal-playlist-position",
    schemaHashes: {
      "app/src/schema.sql": "5a747328ebeda58f7cc52ee31c045160ef29f0239d15a1d9de0ebf677399b7e2",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
    },
    sqlite: [
      { kind: "add-column", table: "user_playlist_videos", column: "position", definition: "INTEGER NOT NULL DEFAULT 0" },
      { kind: "sql", statement: `
        WITH ranked AS (
          SELECT playlist_id, video_id,
                 ROW_NUMBER() OVER (PARTITION BY playlist_id ORDER BY added_at ASC, video_id ASC) - 1 AS position
          FROM user_playlist_videos
        )
        UPDATE user_playlist_videos
        SET position = (
          SELECT ranked.position FROM ranked
          WHERE ranked.playlist_id = user_playlist_videos.playlist_id
            AND ranked.video_id = user_playlist_videos.video_id
        )
      ` },
    ],
    postgres: [
      { kind: "add-column", table: "user_playlist_videos", column: "position", definition: "INTEGER NOT NULL DEFAULT 0" },
      { kind: "sql", statement: `
        WITH ranked AS (
          SELECT playlist_id, video_id,
                 ROW_NUMBER() OVER (PARTITION BY playlist_id ORDER BY added_at ASC, video_id ASC) - 1 AS position
          FROM user_playlist_videos
        )
        UPDATE user_playlist_videos AS target
        SET position = ranked.position
        FROM ranked
        WHERE ranked.playlist_id = target.playlist_id
          AND ranked.video_id = target.video_id
      ` },
    ],
  },
  {
    version: 5,
    name: "tubearchivist-source",
    schemaHashes: {
      "app/src/schema.sql": "5a747328ebeda58f7cc52ee31c045160ef29f0239d15a1d9de0ebf677399b7e2",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "sql", statement: `CREATE TABLE IF NOT EXISTS tube_archivist_items (video_id TEXT PRIMARY KEY REFERENCES videos(video_id) ON DELETE CASCADE, media_url TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', available INTEGER NOT NULL DEFAULT 1, generation INTEGER NOT NULL DEFAULT 0, downloaded_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))` },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_tube_archivist_items_available ON tube_archivist_items(available, downloaded_at DESC)" },
      { kind: "sql", statement: `CREATE TABLE IF NOT EXISTS tube_archivist_sync_state (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), generation INTEGER NOT NULL DEFAULT 0, last_synced_at TEXT, last_error TEXT, running INTEGER NOT NULL DEFAULT 0)` },
      { kind: "sql", statement: `CREATE TABLE IF NOT EXISTS tube_archivist_watch_outbox (video_id TEXT PRIMARY KEY REFERENCES videos(video_id) ON DELETE CASCADE, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')), last_error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))` },
    ],
    postgres: [
      { kind: "sql", statement: `CREATE TABLE IF NOT EXISTS tube_archivist_items (video_id TEXT PRIMARY KEY REFERENCES videos(video_id) ON DELETE CASCADE, media_url TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', available INTEGER NOT NULL DEFAULT 1, generation INTEGER NOT NULL DEFAULT 0, downloaded_at TEXT, updated_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))` },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_tube_archivist_items_available ON tube_archivist_items(available, downloaded_at DESC)" },
      { kind: "sql", statement: `CREATE TABLE IF NOT EXISTS tube_archivist_sync_state (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), generation INTEGER NOT NULL DEFAULT 0, last_synced_at TEXT, last_error TEXT, running INTEGER NOT NULL DEFAULT 0)` },
      { kind: "sql", statement: `CREATE TABLE IF NOT EXISTS tube_archivist_watch_outbox (video_id TEXT PRIMARY KEY REFERENCES videos(video_id) ON DELETE CASCADE, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), last_error TEXT, created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))` },
    ],
  },
  {
    version: 6,
    name: "video-availability-tombstones",
    schemaHashes: {
      "app/src/schema.sql": "5a747328ebeda58f7cc52ee31c045160ef29f0239d15a1d9de0ebf677399b7e2",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "add-column", table: "videos", column: "is_unavailable", definition: "INTEGER NOT NULL DEFAULT 0" },
      { kind: "add-column", table: "videos", column: "availability_checked_at", definition: "TEXT" },
    ],
    postgres: [
      { kind: "add-column", table: "videos", column: "is_unavailable", definition: "INTEGER NOT NULL DEFAULT 0" },
      { kind: "add-column", table: "videos", column: "availability_checked_at", definition: "TEXT" },
    ],
  },
  {
    version: 7,
    name: "related-video-panel",
    schemaHashes: {
      "app/src/schema.sql": "ba49323d51e8391889173a4851aea0b8d536a714e5d048b63981b5be851f4bae",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "sql", statement: `CREATE TABLE IF NOT EXISTS video_related (video_id TEXT PRIMARY KEY REFERENCES videos(video_id) ON DELETE CASCADE, payload TEXT NOT NULL, fetched_at TEXT NOT NULL DEFAULT (datetime('now')))` },
    ],
    postgres: [
      { kind: "sql", statement: `CREATE TABLE IF NOT EXISTS video_related (video_id TEXT PRIMARY KEY REFERENCES videos(video_id) ON DELETE CASCADE, payload TEXT NOT NULL, fetched_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))` },
    ],
  },
  {
    version: 8,
    name: "related-video-panel-per-profile",
    schemaHashes: {
      "app/src/schema.sql": "0657ff8e5ed18b9370c6143f98bcc8140d9eaf60f5f32bc6a341f870f5084775",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    // The rows already stored have no profile that could be recovered: each was
    // fetched by whoever opened the video first, under whatever credentials
    // were reachable then. Carrying them over would attribute one person's
    // recommendations to everybody, which is the defect. They are dropped, and
    // the next open fetches a panel that belongs to the reader.
    sqlite: [
      { kind: "sql", statement: `DROP TABLE IF EXISTS video_related` },
      { kind: "sql", statement: `CREATE TABLE video_related (video_id TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, payload TEXT NOT NULL, fetched_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (video_id, user_id))` },
    ],
    postgres: [
      { kind: "sql", statement: `DROP TABLE IF EXISTS video_related` },
      { kind: "sql", statement: `CREATE TABLE video_related (video_id TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, payload TEXT NOT NULL, fetched_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), PRIMARY KEY (video_id, user_id))` },
    ],
  },
  {
    version: 9,
    name: "video-embeddable",
    schemaHashes: {
      "app/src/schema.sql": "0657ff8e5ed18b9370c6143f98bcc8140d9eaf60f5f32bc6a341f870f5084775",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    // NULL until a watch page says otherwise: the InnerTube and embed
    // fallbacks do not carry the answer, and an unknown must never be mistaken
    // for a refusal — that would send every video the long way round.
    sqlite: [
      { kind: "add-column", table: "videos", column: "embeddable", definition: "INTEGER" },
    ],
    postgres: [
      { kind: "add-column", table: "videos", column: "embeddable", definition: "INTEGER" },
    ],
  },
  {
    version: 101,
    name: "profile-permission-groups",
    schemaHashes: {
      "app/src/schema.sql": "f49d9e1a5b3df6f116bd70a8b6131c271cc18fdf4782cbd67a6d4858f927ae91",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS permission_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, portable_uuid TEXT NOT NULL UNIQUE, name TEXT NOT NULL, is_system INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS permission_group_permissions (group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE, permission TEXT NOT NULL, allowed INTEGER NOT NULL DEFAULT 1 CHECK (allowed IN (0,1)), PRIMARY KEY (group_id, permission))" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS profile_permission_groups (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE RESTRICT)" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS profile_permission_overrides (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, permission TEXT NOT NULL, allowed INTEGER NOT NULL CHECK (allowed IN (0,1)), PRIMARY KEY (user_id, permission))" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS permission_policy (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), default_group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE RESTRICT, revision INTEGER NOT NULL DEFAULT 1)" },
    ],
    postgres: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS permission_groups (id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, portable_uuid TEXT NOT NULL UNIQUE, name TEXT NOT NULL, is_system INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), updated_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS permission_group_permissions (group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE CASCADE, permission TEXT NOT NULL, allowed INTEGER NOT NULL DEFAULT 1 CHECK (allowed IN (0,1)), PRIMARY KEY (group_id, permission))" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS profile_permission_groups (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE RESTRICT)" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS profile_permission_overrides (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, permission TEXT NOT NULL, allowed INTEGER NOT NULL CHECK (allowed IN (0,1)), PRIMARY KEY (user_id, permission))" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS permission_policy (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), default_group_id INTEGER NOT NULL REFERENCES permission_groups(id) ON DELETE RESTRICT, revision INTEGER NOT NULL DEFAULT 1)" },
    ],
  },
  {
    version: 102,
    name: "permission-group-order",
    schemaHashes: {
      "app/src/schema.sql": "7ebc8a637ac2aa8c29630650b453b4432484dc32c4aff85f7a9b8824ccae9e49",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "add-column", table: "permission_groups", column: "sort_order", definition: "INTEGER NOT NULL DEFAULT 0" },
      { kind: "sql", statement: "UPDATE permission_groups SET sort_order=id WHERE sort_order=0" },
    ],
    postgres: [
      { kind: "add-column", table: "permission_groups", column: "sort_order", definition: "INTEGER NOT NULL DEFAULT 0" },
      { kind: "sql", statement: "UPDATE permission_groups SET sort_order=id WHERE sort_order=0" },
    ],
  },
  {
    version: 103,
    name: "external-role-session",
    schemaHashes: {
      "app/src/schema.sql": "9b2cbec713410c5f3a5754205b137fde77a906725963f7353fa8ad1503a1986b",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS auth_sessions (token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, scope TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, permission_group_uuid TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL, last_seen TEXT)" },
      { kind: "add-column", table: "auth_sessions", column: "permission_group_uuid", definition: "TEXT" },
    ],
    postgres: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS auth_sessions (token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, scope TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, permission_group_uuid TEXT, created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), expires_at TEXT NOT NULL, last_seen TEXT)" },
      { kind: "add-column", table: "auth_sessions", column: "permission_group_uuid", definition: "TEXT" },
    ],
  },
  {
    version: 104,
    name: "profile-notification-preferences",
    schemaHashes: {
      "app/src/schema.sql": "8c0bc0ca87a8b3ad0ca28d09f3ec500d6463427899476fa6414097fae737b777",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS notification_preferences (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, source_id TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL CHECK (enabled IN (0,1)), PRIMARY KEY (user_id,kind,source_id))" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_notification_preferences_user ON notification_preferences(user_id)" },
    ],
    postgres: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS notification_preferences (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, source_id TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL CHECK (enabled IN (0,1)), PRIMARY KEY (user_id,kind,source_id))" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_notification_preferences_user ON notification_preferences(user_id)" },
    ],
  },
  {
    version: 105,
    name: "cluster-runtime-state",
    schemaHashes: {
      "app/src/schema.sql": "6f5171419b14024349284382ab45119686e8fcb7206153b5811b7b8263a3510c",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS auth_flows (id TEXT PRIMARY KEY, value TEXT NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, nonce TEXT, expires_at TEXT NOT NULL)" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_auth_flows_expires ON auth_flows(expires_at)" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS child_lock_sessions (token TEXT PRIMARY KEY, expires_at TEXT NOT NULL)" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_child_lock_sessions_expires ON child_lock_sessions(expires_at)" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS playback_activity (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, video_id TEXT NOT NULL, seen_at_ms INTEGER NOT NULL)" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS child_pin_failures (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, failures INTEGER NOT NULL DEFAULT 0)" },
      { kind: "add-column", table: "downloads", column: "progress_percent", definition: "REAL" },
      { kind: "add-column", table: "downloads", column: "progress_total_bytes", definition: "INTEGER" },
      { kind: "add-column", table: "downloads", column: "progress_speed", definition: "TEXT" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS app_events (id INTEGER PRIMARY KEY AUTOINCREMENT, origin TEXT NOT NULL, topic TEXT NOT NULL, user_id INTEGER, data TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_app_events_created ON app_events(created_at)" },
    ],
    postgres: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS auth_flows (id TEXT PRIMARY KEY, value TEXT NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, nonce TEXT, expires_at TEXT NOT NULL)" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_auth_flows_expires ON auth_flows(expires_at)" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS child_lock_sessions (token TEXT PRIMARY KEY, expires_at TEXT NOT NULL)" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_child_lock_sessions_expires ON child_lock_sessions(expires_at)" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS playback_activity (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, video_id TEXT NOT NULL, seen_at_ms BIGINT NOT NULL)" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS child_pin_failures (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, failures INTEGER NOT NULL DEFAULT 0)" },
      { kind: "add-column", table: "downloads", column: "progress_percent", definition: "DOUBLE PRECISION" },
      { kind: "add-column", table: "downloads", column: "progress_total_bytes", definition: "BIGINT" },
      { kind: "add-column", table: "downloads", column: "progress_speed", definition: "TEXT" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS app_events (id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, origin TEXT NOT NULL, topic TEXT NOT NULL, user_id BIGINT, data TEXT, created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_app_events_created ON app_events(created_at)" },
    ],
  },
  {
    version: 106,
    name: "download-worker-ownership",
    schemaHashes: {
      "app/src/schema.sql": "de0bae3f423af39c3269019683f0f87439ca38c1f3fa3211ef09085570f773a1",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "add-column", table: "downloads", column: "worker_id", definition: "TEXT" },
      { kind: "add-column", table: "downloads", column: "worker_heartbeat_at_ms", definition: "INTEGER" },
    ],
    postgres: [
      { kind: "add-column", table: "downloads", column: "worker_id", definition: "TEXT" },
      { kind: "add-column", table: "downloads", column: "worker_heartbeat_at_ms", definition: "BIGINT" },
    ],
  },
  {
    version: 107,
    name: "cluster-instance-heartbeats",
    schemaHashes: {
      "app/src/schema.sql": "6560b93d2aa8f8985992148c9f15f08f04f3168056d9955efe261ffbd0285974",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS cluster_instances (instance_id TEXT PRIMARY KEY, instance_name TEXT NOT NULL, hostname TEXT NOT NULL, started_at_ms INTEGER NOT NULL, last_seen_at_ms INTEGER NOT NULL, version TEXT NOT NULL, commit_hash TEXT NOT NULL, background_tasks INTEGER NOT NULL CHECK (background_tasks IN (0,1)), settings_json TEXT NOT NULL)" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_cluster_instances_last_seen ON cluster_instances(last_seen_at_ms)" },
    ],
    postgres: [
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS cluster_instances (instance_id TEXT PRIMARY KEY, instance_name TEXT NOT NULL, hostname TEXT NOT NULL, started_at_ms BIGINT NOT NULL, last_seen_at_ms BIGINT NOT NULL, version TEXT NOT NULL, commit_hash TEXT NOT NULL, background_tasks INTEGER NOT NULL CHECK (background_tasks IN (0,1)), settings_json TEXT NOT NULL)" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_cluster_instances_last_seen ON cluster_instances(last_seen_at_ms)" },
    ],
  },
  {
    version: 108,
    name: "cluster-download-columns-reconciliation",
    schemaHashes: {
      "app/src/schema.sql": "6560b93d2aa8f8985992148c9f15f08f04f3168056d9955efe261ffbd0285974",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    // Some development databases recorded an earlier form of migration 105
    // before download progress was added. Reconcile every cluster-era queue
    // column under a fresh version so those databases can upgrade safely.
    sqlite: [
      { kind: "add-column", table: "downloads", column: "progress_percent", definition: "REAL" },
      { kind: "add-column", table: "downloads", column: "progress_total_bytes", definition: "INTEGER" },
      { kind: "add-column", table: "downloads", column: "progress_speed", definition: "TEXT" },
      { kind: "add-column", table: "downloads", column: "worker_id", definition: "TEXT" },
      { kind: "add-column", table: "downloads", column: "worker_heartbeat_at_ms", definition: "INTEGER" },
    ],
    postgres: [
      { kind: "add-column", table: "downloads", column: "progress_percent", definition: "DOUBLE PRECISION" },
      { kind: "add-column", table: "downloads", column: "progress_total_bytes", definition: "BIGINT" },
      { kind: "add-column", table: "downloads", column: "progress_speed", definition: "TEXT" },
      { kind: "add-column", table: "downloads", column: "worker_id", definition: "TEXT" },
      { kind: "add-column", table: "downloads", column: "worker_heartbeat_at_ms", definition: "BIGINT" },
    ],
  },
  {
    version: 109,
    name: "playlist-offline-policies",
    schemaHashes: {
      "app/src/schema.sql": "910b1ab5aabd47f187b2d0119bf61278ab0b5571741719c73a04e3b6536a0114",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
    },
    sqlite: [
      { kind: "add-column", table: "user_playlists", column: "offline_policy", definition: "TEXT NOT NULL DEFAULT 'none' CHECK (offline_policy IN ('none', 'download', 'keep'))" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS user_playlist_download_protections (playlist_id INTEGER NOT NULL REFERENCES user_playlists(id) ON DELETE CASCADE, video_id TEXT NOT NULL REFERENCES downloads(video_id) ON DELETE CASCADE, PRIMARY KEY (playlist_id, video_id))" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_user_playlist_download_protections_video ON user_playlist_download_protections(video_id)" },
    ],
    postgres: [
      { kind: "add-column", table: "user_playlists", column: "offline_policy", definition: "TEXT NOT NULL DEFAULT 'none' CHECK (offline_policy IN ('none', 'download', 'keep'))" },
      { kind: "sql", statement: "CREATE TABLE IF NOT EXISTS user_playlist_download_protections (playlist_id BIGINT NOT NULL REFERENCES user_playlists(id) ON DELETE CASCADE, video_id TEXT NOT NULL REFERENCES downloads(video_id) ON DELETE CASCADE, PRIMARY KEY (playlist_id, video_id))" },
      { kind: "sql", statement: "CREATE INDEX IF NOT EXISTS idx_user_playlist_download_protections_video ON user_playlist_download_protections(video_id)" },
    ],
  },
  {
    version: 12,
    name: "video-original-titles",
    schemaHashes: {
      "app/src/schema.sql": "7464674b4e1c8370f630374603552b9929cb2b09031353cf3da3b1cf02c4df8f",
      "app/src/channelPostsSchema.sql": "70a7df33bf373524cf6cd0687e46d7987a7cd90a2619fd9586d12d6f940d45a5",
      "app/src/tubeArchivistSchema.sql": "30b7c3fc889aedc977e2e5cd834cfd48d9e51870530213433359ed24333e03a0",
      "app/src/dailymotionSchema.sql": "6e43314a30a4f5038dfd3cc2f44df69dc48090be8c68be4315090846259cdc7a",
      "app/src/invidiousSchema.sql": "4f77a9670470989f8822b8cc02cc36e073fa57edb20cd81804bf2af4ca3a415b",
    },
    /*
     * One column, and it is never shown to anybody.
     *
     * `title` is what a reader here sees, and YouTube translates a title into
     * whatever language the request asks for — so on a French instance a
     * Japanese video can and should be listed under its French title. The
     * trouble is that the sources which do not translate keep writing over it:
     * the channel feed and oEmbed both hand back what the uploader wrote, and
     * neither can tell "this upload was renamed" from "this title was
     * translated here".
     *
     * Remembering the untranslated title answers that question without asking
     * anybody anything: the feed's title against this one is a rename, and the
     * feed's title against `title` is nothing at all.
     */
    sqlite: [
      { kind: "add-column", table: "videos", column: "title_original", definition: "TEXT" },
    ],
    postgres: [
      { kind: "add-column", table: "videos", column: "title_original", definition: "TEXT" },
    ],
  },
];

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) throw new Error(`unsafe database identifier: ${identifier}`);
  return `"${identifier}"`;
}

async function columnExists(
  client: AsyncDatabaseClient,
  engine: DatabaseEngine,
  table: string,
  column: string,
): Promise<boolean> {
  if (engine === "sqlite") {
    const rows = await client.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all<{ name: string }>();
    return rows.some((row) => row.name === column);
  }
  const row = await client.prepare(`
    SELECT 1 AS present
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ? AND column_name = ?
  `).get(table, column);
  return Boolean(row);
}

async function applyStep(
  client: AsyncDatabaseClient,
  engine: DatabaseEngine,
  step: DatabaseMigrationStep,
): Promise<void> {
  if (step.kind === "noop") return;
  if (step.kind === "sql") {
    await client.exec(step.statement);
    return;
  }
  if (await columnExists(client, engine, step.table, step.column)) return;
  await client.exec(
    `ALTER TABLE ${quoteIdentifier(step.table)} ADD COLUMN ${quoteIdentifier(step.column)} ${step.definition}`,
  );
}

export async function applyDatabaseMigrations(client: AsyncDatabaseClient): Promise<number> {
  await client.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
  let latest = 0;

  for (const migration of DATABASE_MIGRATIONS) {
    latest = Math.max(latest, migration.version);
    await client.transaction(async () => {
      // PostgreSQL replicas may boot together during a rollout. A transaction
      // advisory lock makes schema ownership explicit and is released even if
      // a migration fails or the process disappears.
      if (client.engine === "postgres") await client.prepare("SELECT pg_advisory_xact_lock(1498565714)").get();
      const recorded = await client.prepare("SELECT name FROM schema_migrations WHERE version = ?").get<{ name: string }>(migration.version);
      if (recorded?.name && recorded.name !== migration.name) {
        throw new Error(`database migration ${migration.version} checksum mismatch: expected ${migration.name}, found ${recorded.name}`);
      }
      if (recorded) return;
      for (const step of migration[client.engine]) await applyStep(client, client.engine, step);
      await client.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, migration.name, new Date().toISOString());
    })();
  }
  return latest;
}
