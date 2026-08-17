import type { PlaybackQueueContext } from "./playbackQueue";

/**
 * What plays after the video on screen, once something has been queued.
 *
 * Queuing a suggestion is a statement about what should follow, so it has to
 * reach the video already playing. Without that, the queue was a list that only
 * did something once somebody went and started it from its own menu — and the
 * video on screen ran out into whatever the feed offered instead.
 *
 * A playlist opened on purpose outranks it: somebody chose that order, and a
 * queued video does not get to interrupt it. Everything else gives way — the
 * current video becomes the head of the queue and the rest follows it.
 */
export function effectivePlaybackQueue(
  base: PlaybackQueueContext | null,
  currentVideoId: string | undefined,
  queuedVideoIds: readonly string[],
): PlaybackQueueContext | null {
  if (base?.kind === "user-playlist" || base?.kind === "channel-playlist") return base;
  // Queuing what is already on screen would otherwise make it its own next.
  const queued = queuedVideoIds.filter((videoId) => videoId !== currentVideoId);
  if (!currentVideoId || queued.length === 0) return base;
  return { version: 1, kind: "session", ids: [currentVideoId, ...queued] };
}
