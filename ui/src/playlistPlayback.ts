import type { Video } from "./apiTypes";
import type { PlaybackQueueContext } from "./playbackQueue";

export type PlaybackEndAction = "stop" | "offer" | "advance";

/**
 * A queue that is played through rather than stepped around in.
 *
 * A session queue is a list someone assembled deliberately, so it runs on to
 * the end the way a playlist does — forwards whatever the feed's autoplay
 * direction happens to say.
 */
export function isContinuousPlaylistQueue(
  queue: PlaybackQueueContext | null,
): queue is Extract<PlaybackQueueContext, { kind: "user-playlist" | "channel-playlist" | "session" }> {
  return queue?.kind === "user-playlist" || queue?.kind === "channel-playlist" || queue?.kind === "session";
}

export function playbackEndAction(
  queue: PlaybackQueueContext | null,
  hasNext: boolean,
  feedAutoplayEnabled: boolean,
): PlaybackEndAction {
  if (!hasNext) return "stop";
  if (isContinuousPlaylistQueue(queue)) return "advance";
  return feedAutoplayEnabled ? "offer" : "stop";
}

/**
 * Continue after the furthest completed or explicitly skipped item in the
 * currently displayed order. Unhandled gaps before that frontier were
 * deliberately passed over and should not pull a long playlist backwards when
 * the listener returns.
 */
export function playlistContinueTarget<T extends Pick<Video, "status" | "watched">>(videos: readonly T[]): T | null {
  for (let index = videos.length - 1; index >= 0; index--) {
    if (videos[index].watched === 1 || videos[index].status === "archived") return videos[index + 1] ?? null;
  }
  return null;
}

/**
 * Where a single press of play on a whole list should land.
 *
 * The playlist's own page can afford two buttons and shows both: resume where
 * this list was left, and start it over. A row in the sidebar cannot, and one
 * of the two has to be what the press means. Resuming is the one that is never
 * wrong — a list nobody has started resumes at its first video anyway, which is
 * exactly what starting it over would have done.
 */
export function playlistStartTarget<T extends Pick<Video, "status" | "watched">>(videos: readonly T[]): T | null {
  return playlistContinueTarget(videos) ?? videos[0] ?? null;
}

export function videosInPlaylistOrder<T extends Pick<Video, "video_id">>(videos: readonly T[], order: readonly string[]): T[] {
  const byId = new Map(videos.map((video) => [video.video_id, video]));
  const seen = new Set<string>();
  const ordered = order.flatMap((videoId) => {
    const video = byId.get(videoId);
    if (!video || seen.has(videoId)) return [];
    seen.add(videoId);
    return [video];
  });
  return [...ordered, ...videos.filter((video) => !seen.has(video.video_id))];
}
