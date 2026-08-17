import { database } from "./database";
import { log } from "./logger";
import type { RelatedVideo } from "./relatedVideos";

/**
 * Where a profile's side panel is kept between the fetch that read it and the
 * page that shows it.
 *
 * A panel is read from YouTube as somebody. It therefore carries that
 * account's taste, and it belongs to the profile it was fetched for — keyed on
 * the video alone, it was fetched once by whoever opened the video first and
 * served to everyone afterwards. One person's recommendations, handed to the
 * household. The rows are keyed on both now.
 *
 * Nothing here creates videos. A suggestion is a title and a thumbnail until
 * somebody acts on it, and only then does it earn a row of its own.
 */
const MAX_STORED = 25;

/**
 * How long a stored panel still counts as this profile's answer.
 *
 * YouTube's own suggestions move with what an account watches, so a panel read
 * weeks ago describes a viewer who has since moved on. A day is long enough
 * that opening the same video twice in an evening costs one request, and short
 * enough that the panel is never the archive of a former self.
 */
const PANEL_TTL_MS = 24 * 60 * 60_000;

/**
 * A panel belongs to a video the library has, and says so by foreign key.
 *
 * Suggestions can be fetched for a video that has no row — somebody opened one
 * from a panel, and the page asks before the import that would create it has
 * finished, or at all. The row is a condition of the write rather than a hope,
 * and the panel that could not be stored is still the one returned to the page.
 */
export async function saveRelatedVideos(
  videoId: string,
  userId: number,
  videos: readonly RelatedVideo[],
  source = "video",
): Promise<void> {
  if (videos.length === 0) return;
  try {
    await database.prepare(
      `INSERT INTO video_related (video_id, user_id, payload, fetched_at)
       SELECT ?, ?, ?, datetime('now') WHERE EXISTS (SELECT 1 FROM videos WHERE video_id = ?)
       ON CONFLICT(video_id, user_id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`
    ).run(videoId, userId, JSON.stringify({ source, videos: videos.slice(0, MAX_STORED) }), videoId);
  } catch (error) {
    // A panel nobody has yet asked for is not worth failing an import over.
    log.warn("related.save_failed", { videoId, userId, error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * A panel is the answer to a particular question, and it stops being an answer
 * when the question changes.
 *
 * Asked about the video, about the account, or about both, YouTube gives three
 * different lists. Kept without recording which was asked, a panel outlives
 * the setting that produced it: changing the setting appeared to do nothing
 * for a day, and every experiment had to be preceded by a manual refresh
 * nobody could be expected to know about.
 */
export async function readRelatedVideos(
  videoId: string,
  userId: number,
  limit: number,
  source = "video",
  now: () => number = Date.now,
): Promise<RelatedVideo[]> {
  if (limit <= 0) return [];
  const row = await database.prepare("SELECT payload, fetched_at FROM video_related WHERE video_id = ? AND user_id = ?")
    .get(videoId, userId) as { payload: string; fetched_at: string } | null;
  if (!row) return [];
  const fetchedAt = Date.parse(`${row.fetched_at.replace(" ", "T")}Z`);
  if (Number.isFinite(fetchedAt) && now() - fetchedAt > PANEL_TTL_MS) return [];
  try {
    const parsed = JSON.parse(row.payload);
    // The older shape was the bare list, from before a panel recorded which
    // question it answered. It cannot say, so it is not an answer any more.
    if (Array.isArray(parsed)) return [];
    if (!parsed || typeof parsed !== "object" || parsed.source !== source) return [];
    return Array.isArray(parsed.videos) ? parsed.videos.slice(0, limit) : [];
  } catch {
    return [];
  }
}

/** Forget this profile's panel, so the next read fetches a fresh one. */
export async function forgetRelatedVideos(videoId: string, userId: number): Promise<void> {
  await database.prepare("DELETE FROM video_related WHERE video_id = ? AND user_id = ?").run(videoId, userId);
}
