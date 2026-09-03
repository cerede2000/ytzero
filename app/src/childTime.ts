// Watch-time accounting for every profile (feeds the child limits today and
// the stats pages later) plus child-profile locks: daily time limits with
// parent-granted extensions, and a lockout after repeated wrong child-lock
// PINs. Enforcement is cooperative — the server stops counting and reports
// `locked`, and the UI locks the screen.
import { database, databaseConfig } from "./database";
import { getUserSetting, setUserSetting } from "./db";
import { recordWatchTagSignals } from "./contentSignals";
import { zonedDayHour } from "./timeZone";
import { publishAppEvent } from "./appEvents";

export type ChildGrant = "15m" | "1h" | "video_end" | "today_off";
export const CHILD_GRANTS: ChildGrant[] = ["15m", "1h", "video_end", "today_off"];

const today = () => zonedDayHour().day;

export async function isChildUser(userId: number): Promise<boolean> {
  const row = await database.prepare("SELECT is_child FROM users WHERE id = ?").get(userId) as { is_child: number } | null;
  return row?.is_child === 1;
}

/** Configured daily limit in seconds, or null when the profile has no limit. */
export function childLimitSeconds(userId: number): number | null {
  const min = parseInt(getUserSetting(userId, "child_limit_minutes") ?? "", 10);
  return Number.isFinite(min) && min > 0 ? min * 60 : null;
}

// ---------- watch-time log (all profiles) ----------

// Progress heartbeats arrive up to ~10 s apart while a video actually plays,
// so wall-clock deltas between ticks are a good watch-time measure; a gap wider
// than 15 s means pause/navigation and is not counted. The latest heartbeat is
// database-backed so consecutive requests may land on different HTTP replicas.
const lastChildEvent = new Map<number, number>();
const childIdleTimers = new Map<number, ReturnType<typeof setTimeout>>();

/** Active playback heartbeats, used by the small parent "now watching" panel. */
export async function activeChildPlayback(maxAgeMs = 12_000) {
  const cutoff = Date.now() - maxAgeMs;
  const rows = await database.prepare(`
    SELECT activity.user_id, activity.video_id
    FROM playback_activity activity JOIN users u ON u.id=activity.user_id
    WHERE u.is_child=1 AND activity.seen_at_ms >= ?
  `).all(cutoff) as Array<{ user_id: number; video_id: string }>;
  return rows.map((row) => ({ userId: Number(row.user_id), videoId: row.video_id }));
}

export async function recordWatchTick(userId: number, videoId: string) {
  if (isParentLocked(userId)) return;
  const now = Date.now();
  const last = await database.transaction(async () => {
    const row = await database.prepare(`SELECT video_id, seen_at_ms FROM playback_activity WHERE user_id = ?${databaseConfig.engine === "postgres" ? " FOR UPDATE" : ""}`)
      .get<{ video_id: string; seen_at_ms: number }>(userId);
    await database.prepare(`
      INSERT INTO playback_activity(user_id, video_id, seen_at_ms) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET video_id=excluded.video_id, seen_at_ms=excluded.seen_at_ms
    `).run(userId, videoId, now);
    return row ? { at: Number(row.seen_at_ms), videoId: row.video_id } : null;
  })();
  const child = await isChildUser(userId);
  if (child && now - (lastChildEvent.get(userId) ?? 0) >= 2_000) {
    lastChildEvent.set(userId, now);
    publishAppEvent("child-status");
    publishAppEvent("child-watching");
  }
  if (child) {
    const idleTimer = childIdleTimers.get(userId);
    if (idleTimer) clearTimeout(idleTimer);
    childIdleTimers.set(userId, setTimeout(() => {
      childIdleTimers.delete(userId);
      publishAppEvent("child-watching");
    }, 12_500));
  }
  if (!last) return;
  const delta = (now - last.at) / 1000;
  if (delta <= 0 || delta > 15) return;
  const local = zonedDayHour(new Date(now));
  await database.prepare(
    `INSERT INTO watch_time_log (user_id, video_id, day, hour, seconds)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, video_id, day, hour) DO UPDATE SET seconds = watch_time_log.seconds + excluded.seconds`
  ).run(userId, videoId, local.day, local.hour, delta);
  await recordWatchTagSignals(userId, videoId, delta, local);
}

/** The video the user was most recently watching (for "until video ends"). */
export async function lastWatchedVideo(userId: number): Promise<string | null> {
  const row = await database.prepare("SELECT video_id FROM playback_activity WHERE user_id = ?").get<{ video_id: string }>(userId);
  return row?.video_id ?? null;
}

async function usedSecondsToday(userId: number): Promise<number> {
  return (await database.prepare("SELECT COALESCE(SUM(seconds), 0) AS s FROM watch_time_log WHERE user_id = ? AND day = ?")
    .get(userId, today()) as { s: number }).s;
}

// ---------- child-lock PIN lockout ----------

// Wrong child-lock PIN attempts (leaving the profile, approving extensions)
// count against the child profile; the third one locks it. The lock lives in
// user_settings so it survives restarts; the counter is transient DB state.
const PIN_LOCK_MINUTES = 30;
const PIN_LOCK_ATTEMPTS = 3;

export function isPinLocked(userId: number): boolean {
  const until = getUserSetting(userId, "child_pin_lock_until");
  return Boolean(until && Date.parse(until) > Date.now());
}

export function isParentLocked(userId: number): boolean {
  return getUserSetting(userId, "child_parent_locked") === "1";
}

export async function lockChildByParent(userId: number) {
  await setUserSetting(userId, "child_parent_locked", "1");
  await database.prepare("DELETE FROM playback_activity WHERE user_id = ?").run(userId);
}

/** Count one failed attempt; returns true when this attempt locked the profile. */
export async function registerChildLockFailure(userId: number): Promise<boolean> {
  if (!await isChildUser(userId)) return false;
  const row = await database.prepare(`
    INSERT INTO child_pin_failures(user_id, failures) VALUES (?, 1)
    ON CONFLICT(user_id) DO UPDATE SET failures=child_pin_failures.failures + 1
    RETURNING failures
  `).get<{ failures: number }>(userId);
  if (Number(row?.failures ?? 0) < PIN_LOCK_ATTEMPTS) return false;
  await database.prepare("DELETE FROM child_pin_failures WHERE user_id = ?").run(userId);
  await setUserSetting(userId, "child_pin_lock_until", new Date(Date.now() + PIN_LOCK_MINUTES * 60_000).toISOString());
  return true;
}

export async function clearChildLockFailures(userId: number) {
  await database.prepare("DELETE FROM child_pin_failures WHERE user_id = ?").run(userId);
}

export async function unlockChildProfile(userId: number) {
  await clearChildLockFailures(userId);
  await setUserSetting(userId, "child_pin_lock_until", "");
  await setUserSetting(userId, "child_parent_locked", "");
}

// ---------- status & grants ----------

export interface ChildStatus {
  is_child: boolean;
  limit_seconds: number | null;
  used_seconds: number;
  extra_seconds: number;
  unlimited_today: boolean;
  remaining_seconds: number | null;
  locked: boolean;
  lock_reason: "time" | "pin" | "parent" | null;
  local_only: boolean;
  hide_shorts: boolean;
  hide_live: boolean;
  downloads_only: boolean;
  has_pending_request: boolean;
}

export async function childStatus(userId: number): Promise<ChildStatus> {
  if (!await isChildUser(userId)) {
    return {
      is_child: false, limit_seconds: null, used_seconds: 0, extra_seconds: 0,
      unlimited_today: false, remaining_seconds: null, locked: false, lock_reason: null,
      local_only: false, hide_shorts: false, hide_live: false, downloads_only: false,
      has_pending_request: false,
    };
  }
  const limit = childLimitSeconds(userId);
  const used = await usedSecondsToday(userId);
  const extras = await database.prepare("SELECT extra_seconds, unlimited FROM child_time_extras WHERE user_id = ? AND day = ?")
    .get(userId, today()) as { extra_seconds: number; unlimited: number } | null;
  const extra = extras?.extra_seconds ?? 0;
  const unlimited = extras?.unlimited === 1;
  const remaining = limit == null || unlimited ? null : Math.max(0, limit + extra - used);
  const pinLocked = isPinLocked(userId);
  const parentLocked = isParentLocked(userId);
  const timeLocked = remaining != null && remaining <= 0;
  const pending = await database.prepare(
    "SELECT 1 FROM child_time_requests WHERE user_id = ? AND status = 'pending' AND created_at > datetime('now', '-1 hour')"
  ).get(userId);
  return {
    is_child: true,
    limit_seconds: limit,
    used_seconds: Math.round(used),
    extra_seconds: Math.round(extra),
    unlimited_today: unlimited,
    remaining_seconds: remaining == null ? null : Math.round(remaining),
    locked: pinLocked || parentLocked || timeLocked,
    lock_reason: parentLocked ? "parent" : pinLocked ? "pin" : timeLocked ? "time" : null,
    local_only: getUserSetting(userId, "child_local_only") === "1",
    hide_shorts: getUserSetting(userId, "child_hide_shorts") === "1",
    hide_live: getUserSetting(userId, "child_hide_live") === "1",
    downloads_only: getUserSetting(userId, "child_downloads_only") === "1",
    has_pending_request: Boolean(pending),
  };
}

/** Child profile restricted to locally downloaded files (no YouTube playback). */
export function childDownloadsOnly(userId: number): boolean {
  return getUserSetting(userId, "child_downloads_only") === "1";
}

export function childLocalOnly(userId: number): boolean {
  return getUserSetting(userId, "child_local_only") === "1";
}

export function childHidesLive(userId: number): boolean {
  return getUserSetting(userId, "child_hide_live") === "1";
}

export async function applyGrant(userId: number, grant: ChildGrant, videoId: string | null) {
  const day = today();
  if (grant === "today_off") {
    await database.prepare(
      `INSERT INTO child_time_extras (user_id, day, unlimited) VALUES (?, ?, 1)
       ON CONFLICT(user_id, day) DO UPDATE SET unlimited = 1`
    ).run(userId, day);
    return;
  }
  let seconds = grant === "1h" ? 3600 : 900;
  if (grant === "video_end" && videoId) {
    const row = await database.prepare(
      "SELECT watch_position, watch_duration FROM user_videos WHERE user_id = ? AND video_id = ?"
    ).get(userId, videoId) as { watch_position: number | null; watch_duration: number | null } | null;
    if (row?.watch_duration && row.watch_position != null) {
      // Remaining runtime plus a small buffer so the video can actually finish.
      seconds = Math.max(60, Math.round(row.watch_duration - row.watch_position) + 60);
    }
  }
  // The grant means "this much time from now": raise the extras so remaining
  // time equals the grant even when usage overshot the limit (a slow lock,
  // another device), but never shrink extras that are already larger.
  const limit = childLimitSeconds(userId) ?? 0;
  const used = await usedSecondsToday(userId);
  const current = (await database.prepare("SELECT extra_seconds FROM child_time_extras WHERE user_id = ? AND day = ?")
    .get(userId, day) as { extra_seconds: number } | null)?.extra_seconds ?? 0;
  const extra = Math.max(current + seconds, Math.round(used - limit + seconds));
  await database.prepare(
    `INSERT INTO child_time_extras (user_id, day, extra_seconds) VALUES (?, ?, ?)
     ON CONFLICT(user_id, day) DO UPDATE SET extra_seconds = excluded.extra_seconds`
  ).run(userId, day, extra);
}
