import { database } from "./database";
import { log } from "./logger";
import type { RelatedVideo } from "./relatedVideos";

/**
 * Where the side panel is kept between the import that read it and the page
 * that shows it.
 *
 * It is read once, when the video is imported, because that is the only moment
 * the watch page is downloaded anyway. Storing it is what makes it survive
 * until somebody opens the video — which may be days later, and by then asking
 * YouTube again would be a request bought for nothing.
 *
 * Nothing here creates videos. A suggestion is a title and a thumbnail until
 * somebody acts on it, and only then does it earn a row of its own.
 */
const MAX_STORED = 25;

export async function saveRelatedVideos(videoId: string, videos: readonly RelatedVideo[]): Promise<void> {
  if (videos.length === 0) return;
  try {
    await database.prepare(
      `INSERT INTO video_related (video_id, payload, fetched_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(video_id) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`
    ).run(videoId, JSON.stringify(videos.slice(0, MAX_STORED)));
  } catch (error) {
    // A panel nobody has yet asked for is not worth failing an import over.
    log.warn("related.save_failed", { videoId, error: error instanceof Error ? error.message : String(error) });
  }
}

export async function readRelatedVideos(videoId: string, limit: number): Promise<RelatedVideo[]> {
  if (limit <= 0) return [];
  const row = await database.prepare("SELECT payload FROM video_related WHERE video_id = ?")
    .get(videoId) as { payload: string } | null;
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.payload);
    return Array.isArray(parsed) ? parsed.slice(0, limit) : [];
  } catch {
    return [];
  }
}
