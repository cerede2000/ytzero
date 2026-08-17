import type { Video } from "./apiTypes";

export const WATCHLIST_SORTS = ["schedule", "duration-asc", "duration-desc", "title-asc", "channel-asc"] as const;
export type WatchlistSort = (typeof WATCHLIST_SORTS)[number];
const PLAYLIST_SORTS = ["playlist-order", "oldest", "newest", "title-asc", "title-desc"] as const;
const USER_PLAYLIST_SORTS = [...PLAYLIST_SORTS, "added-oldest", "added-newest"] as const;

export type PlaybackQueueContext =
  | { version: 1; kind: "feed"; tags: number[]; showAll: boolean; sort: "published" | "arrival" }
  | { version: 1; kind: "liked"; showShorts: boolean }
  | { version: 1; kind: "history" }
  | { version: 1; kind: "archive" }
  | { version: 1; kind: "user-playlist"; playlistUuid: string; sort: (typeof USER_PLAYLIST_SORTS)[number] }
  | { version: 1; kind: "channel-playlist"; playlistId: string; sort: (typeof PLAYLIST_SORTS)[number] }
  | { version: 1; kind: "watchlist"; sort: WatchlistSort; dueOnly: boolean }
  | { version: 1; kind: "recommendations" }
  | { version: 1; kind: "in-progress" }
  | { version: 1; kind: "session"; ids: string[] };

export const SESSION_PLAY_QUEUE_MAX_ITEMS = 100;
const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

/**
 * Options a caller can attach to starting playback.
 *
 * `fromStart` says this is the opening of a list rather than the resuming of
 * something watched: a remembered position belongs to the video you left, not
 * to the list you just pressed play on.
 */
export interface PlayOptions {
  fromStart?: boolean;
  /**
   * Start this in audio rather than video.
   *
   * The choice was made on the page being left, and the remembered preference
   * it also writes is scoped to the profile this browser remembers being. A
   * browser that has never been told which profile it is has nothing to key
   * that on, so the preference is dropped and the page opens in video — the
   * button appears to do nothing at all, on that device only.
   *
   * Travelling with the navigation, beside `fromStart`, makes the choice
   * independent of what the browser happens to remember. The preference is
   * still written, so it sticks for the videos that follow.
   */
  audio?: boolean;
}

export type PlayVideo = (video: Video, queue?: PlaybackQueueContext, options?: PlayOptions) => void;

export function isPlaybackQueueContext(value: unknown): value is PlaybackQueueContext {
  if (!value || typeof value !== "object") return false;
  const queue = value as Partial<PlaybackQueueContext>;
  if (queue.version !== 1) return false;
  if (queue.kind === "feed") return Array.isArray(queue.tags) && queue.tags.every((tag) => Number.isSafeInteger(tag) && tag > 0)
    && typeof queue.showAll === "boolean" && (queue.sort === "published" || queue.sort === "arrival");
  if (queue.kind === "liked") return typeof queue.showShorts === "boolean";
  if (queue.kind === "session") return Array.isArray(queue.ids) && queue.ids.length <= SESSION_PLAY_QUEUE_MAX_ITEMS
    && queue.ids.every((id) => typeof id === "string" && VIDEO_ID.test(id));
  if (queue.kind === "user-playlist") return typeof queue.playlistUuid === "string" && queue.playlistUuid.length > 0
    && (queue.sort === undefined || (USER_PLAYLIST_SORTS as readonly unknown[]).includes(queue.sort));
  if (queue.kind === "channel-playlist") return typeof queue.playlistId === "string" && queue.playlistId.length > 0
    && (PLAYLIST_SORTS as readonly unknown[]).includes(queue.sort);
  if (queue.kind === "watchlist") return typeof queue.dueOnly === "boolean" && (WATCHLIST_SORTS as readonly unknown[]).includes(queue.sort);
  if (queue.kind === "session") return Array.isArray(queue.ids) && queue.ids.length > 0
    && queue.ids.every((id) => typeof id === "string" && id.length > 0);
  return queue.kind === "history" || queue.kind === "archive" || queue.kind === "recommendations" || queue.kind === "in-progress";
}
