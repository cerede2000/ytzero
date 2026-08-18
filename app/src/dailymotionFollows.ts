import { database } from "./database";
import { validDailymotionChannelId, validDailymotionVideoId } from "./dailymotion";

/**
 * The reader's side of Dailymotion, and nothing else.
 *
 * Two tables of our own, referencing nothing: what is kept here is a
 * relationship — which channels somebody follows, how far into a video they
 * got — never the video or the channel themselves. A title, a duration and a
 * thumbnail belong to Dailymotion and are asked for when they are needed, so
 * none of them is copied into a database that would then have to keep them
 * current.
 *
 * It is also what makes the experiment removable: no foreign key points here
 * and none points out, so dropping these two tables drops the whole of it.
 */

export interface DailymotionFollow {
  channelId: string;
  screenname: string;
  avatar: string;
  /** Everything published after this instant is new to this reader. */
  seenThrough: number;
}

export async function listFollows(userId: number): Promise<DailymotionFollow[]> {
  const rows = await database.prepare(
    `SELECT channel_id, screenname, avatar, seen_through
       FROM dailymotion_follows
      WHERE user_id = ?
      ORDER BY added_at DESC`,
  ).all<{ channel_id: string; screenname: string; avatar: string; seen_through: number }>(userId);
  return rows.map((row) => ({
    channelId: row.channel_id,
    screenname: row.screenname,
    avatar: row.avatar,
    seenThrough: Number(row.seen_through) || 0,
  }));
}

export async function isFollowing(userId: number, channelId: string): Promise<boolean> {
  const row = await database.prepare(
    "SELECT 1 AS found FROM dailymotion_follows WHERE user_id = ? AND channel_id = ?",
  ).get<{ found: number }>(userId, channelId);
  return Boolean(row);
}

/**
 * Followed from now on, not from the beginning of time.
 *
 * `seen_through` starts at the moment of following: a channel with three
 * thousand videos would otherwise arrive as three thousand novelties. What is
 * already there is browsed on the channel's own page; what is new is what
 * happens next.
 */
export async function follow(
  userId: number,
  channel: { channelId: string; screenname: string; avatar: string },
  now = Date.now(),
): Promise<boolean> {
  if (!validDailymotionChannelId(channel.channelId)) return false;
  await database.prepare(
    `INSERT INTO dailymotion_follows (user_id, channel_id, screenname, avatar, seen_through)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, channel_id) DO UPDATE SET screenname = excluded.screenname, avatar = excluded.avatar`,
  ).run(userId, channel.channelId, channel.screenname, channel.avatar, Math.floor(now / 1000));
  return true;
}

export async function unfollow(userId: number, channelId: string): Promise<void> {
  await database.prepare("DELETE FROM dailymotion_follows WHERE user_id = ? AND channel_id = ?").run(userId, channelId);
}

/** Everything up to here has been offered; only what comes after is new. */
export async function markSeen(userId: number, through: number, channelId?: string): Promise<void> {
  const seconds = Math.floor(through);
  if (channelId) {
    await database.prepare(
      "UPDATE dailymotion_follows SET seen_through = ? WHERE user_id = ? AND channel_id = ? AND seen_through < ?",
    ).run(seconds, userId, channelId, seconds);
    return;
  }
  await database.prepare(
    "UPDATE dailymotion_follows SET seen_through = ? WHERE user_id = ? AND seen_through < ?",
  ).run(seconds, userId, seconds);
}

export interface DailymotionProgress {
  positionSeconds: number;
  durationSeconds: number | null;
  watched: boolean;
}

/** Where the reader got to, for the handful of videos a page is about to draw. */
export async function progressFor(userId: number, videoIds: readonly string[]): Promise<Record<string, DailymotionProgress>> {
  const wanted = [...new Set(videoIds)].filter(validDailymotionVideoId);
  if (!wanted.length) return {};
  const rows = await database.prepare(
    `SELECT video_id, position_seconds, duration_seconds, watched
       FROM dailymotion_progress
      WHERE user_id = ? AND video_id IN (${wanted.map(() => "?").join(", ")})`,
  ).all<{ video_id: string; position_seconds: number; duration_seconds: number | null; watched: number }>(userId, ...wanted);
  const found: Record<string, DailymotionProgress> = {};
  for (const row of rows) {
    found[row.video_id] = {
      positionSeconds: Number(row.position_seconds) || 0,
      durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
      watched: Boolean(row.watched),
    };
  }
  return found;
}

/** Watched enough that offering to resume would be offering the credits. */
const WATCHED_FRACTION = 0.95;

/**
 * Whether this counts as watched.
 *
 * A duration is needed to answer at all: without one there is no fraction, and
 * guessing would either resume somebody at the credits or forget they had
 * finished. Unknown means not watched, which is the recoverable mistake.
 */
export function watchedFromProgress(positionSeconds: number, durationSeconds: number | null): boolean {
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return false;
  if (!Number.isFinite(positionSeconds)) return false;
  return positionSeconds / durationSeconds >= WATCHED_FRACTION;
}

export async function saveProgress(
  userId: number,
  videoId: string,
  positionSeconds: number,
  durationSeconds: number | null,
  now = new Date(),
): Promise<boolean> {
  if (!validDailymotionVideoId(videoId)) return false;
  const position = Number.isFinite(positionSeconds) ? Math.max(0, positionSeconds) : 0;
  const duration = durationSeconds != null && Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : null;
  const watched = watchedFromProgress(position, duration) ? 1 : 0;
  // Stamped from here rather than by a default, which only fires on insert:
  // a row that is updated for an hour would otherwise claim it was last
  // touched when the video was first opened.
  const stamp = now.toISOString().slice(0, 19).replace("T", " ");
  await database.prepare(
    `INSERT INTO dailymotion_progress (user_id, video_id, position_seconds, duration_seconds, watched, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, video_id) DO UPDATE
       SET position_seconds = excluded.position_seconds,
           duration_seconds = COALESCE(excluded.duration_seconds, dailymotion_progress.duration_seconds),
           watched = excluded.watched,
           updated_at = excluded.updated_at`,
  ).run(userId, videoId, position, duration, watched, stamp);
  return true;
}
