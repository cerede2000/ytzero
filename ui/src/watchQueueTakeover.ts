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
  if (!currentVideoId || queuedVideoIds.length === 0) return base;
  /*
   * Once inside the queue, the queue's own order is the order.
   *
   * Putting the video playing at the head unconditionally rotates the list at
   * every step: from the second entry the rest reads as [first, third], so
   * "next" goes back to the first and the third is never reached. The head is
   * only for the video somebody was watching when they queued something —
   * which, by definition, is not in the queue.
   */
  if (queuedVideoIds.includes(currentVideoId)) return { version: 1, kind: "session", ids: [...queuedVideoIds] };
  return { version: 1, kind: "session", ids: [currentVideoId, ...queuedVideoIds] };
}
