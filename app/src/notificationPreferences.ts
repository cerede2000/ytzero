import { database } from "./database";

export const NOTIFICATION_CATEGORIES = [
  "channel_video",
  "playlist_video",
  "download_failed",
  "social",
  "app_update",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type NotificationSourceType = "channel" | "playlist";

export const NOTIFICATION_CATEGORY_DEFAULTS: Record<NotificationCategory, boolean> = {
  // Channel-upload notifications are new and intentionally opt-in. Existing
  // notification types retain their historical enabled behaviour.
  channel_video: false,
  playlist_video: true,
  download_failed: true,
  social: true,
  app_update: true,
};

export function notificationCategory(kind: string): NotificationCategory | string {
  return kind.startsWith("social_") ? "social" : kind;
}

export function sourceKind(sourceType: NotificationSourceType): NotificationCategory {
  return sourceType === "channel" ? "channel_video" : "playlist_video";
}

function defaultEnabled(kind: string): boolean {
  return NOTIFICATION_CATEGORY_DEFAULTS[kind as NotificationCategory] ?? true;
}

export async function notificationEnabled(userId: number, kind: string, sourceId = ""): Promise<boolean> {
  const category = notificationCategory(kind);
  const rows = await database.prepare(`
    SELECT kind, source_id, enabled
    FROM notification_preferences
    WHERE user_id = ? AND (
      (kind = '*' AND source_id = '')
      OR (kind = ? AND source_id = '')
      OR (kind = ? AND source_id = ?)
    )
  `).all<{ kind: string; source_id: string; enabled: number }>(userId, category, category, sourceId);
  const values = new Map(rows.map((row) => [`${row.kind}:${row.source_id}`, row.enabled === 1]));
  if (values.get("*:") === false) return false;
  if (sourceId && values.has(`${category}:${sourceId}`)) return values.get(`${category}:${sourceId}`)!;
  return values.get(`${category}:`) ?? defaultEnabled(category);
}

export async function setNotificationPreference(userId: number, kind: string, sourceId: string, enabled: boolean | null): Promise<void> {
  if (enabled === null) {
    await database.prepare("DELETE FROM notification_preferences WHERE user_id=? AND kind=? AND source_id=?")
      .run(userId, kind, sourceId);
    return;
  }
  await database.prepare(`
    INSERT INTO notification_preferences(user_id,kind,source_id,enabled)
    VALUES(?,?,?,?)
    ON CONFLICT(user_id,kind,source_id) DO UPDATE SET enabled=excluded.enabled
  `).run(userId, kind, sourceId, enabled ? 1 : 0);
}

export async function notificationPreferenceSnapshot(userId: number) {
  const rows = await database.prepare("SELECT kind,source_id,enabled FROM notification_preferences WHERE user_id=?")
    .all<{ kind: string; source_id: string; enabled: number }>(userId);
  const values = new Map(rows.map((row) => [`${row.kind}:${row.source_id}`, row.enabled === 1]));
  const enabled = values.get("*:") ?? true;
  const categories = Object.fromEntries(NOTIFICATION_CATEGORIES.map((kind) => [kind, values.get(`${kind}:`) ?? NOTIFICATION_CATEGORY_DEFAULTS[kind]]));
  const overrides = rows
    .filter((row) => row.source_id && (row.kind === "channel_video" || row.kind === "playlist_video"))
    .map((row) => ({ sourceType: row.kind === "channel_video" ? "channel" as const : "playlist" as const, sourceId: row.source_id, enabled: row.enabled === 1 }));
  return { enabled, categories, overrides };
}
