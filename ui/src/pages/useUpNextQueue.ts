import { useCallback, useEffect, useRef, useState } from "react";
import type { NavigateFunction } from "react-router-dom";
import { api, type Video } from "../api";
import type { PlaybackQueueContext } from "../playbackQueue";
import { sessionPlayQueueItems } from "../sessionPlayQueue";

type Direction = "oldest" | "newest";

export type QueueDisplayVideo = Pick<Video, "video_id" | "title" | "thumbnail" | "channel_title">;
async function resolveNextVideo(queue: PlaybackQueueContext, videoId: string, direction: Direction, relative: "next" | "previous" = "next"): Promise<{ video: QueueDisplayVideo | null }> {
  const result = await api.playbackAdjacent(videoId, direction, queue, relative);
  if (!result.video_id) return { video: null };
  try { return { video: (await api.video(result.video_id)).video }; }
  catch {
    const fallback = queue.kind === "session" ? sessionPlayQueueItems().find((item) => item.video_id === result.video_id) : null;
    return { video: fallback ?? null };
  }
}

export function useUpNextQueue({ currentVideoId, direction, navigate, queue }: {
  currentVideoId: string | undefined;
  direction: Direction;
  navigate: NavigateFunction;
  queue: PlaybackQueueContext | null;
}) {
  const requestRef = useRef(0);
  const [prefetched, setPrefetched] = useState<QueueDisplayVideo | null>(null);
  const [video, setVideo] = useState<QueueDisplayVideo | null>(null);
  const [previous, setPrevious] = useState<QueueDisplayVideo | null>(null);
  const [loadingNext, setLoadingNext] = useState(false);

  useEffect(() => {
    requestRef.current++;
    setLoadingNext(false);
    setPrefetched(null);
    setPrevious(null);
    setVideo(null);
    if (!currentVideoId || !queue) return;
    let cancelled = false;
    resolveNextVideo(queue, currentVideoId, direction)
      .then((result) => { if (!cancelled) setPrefetched(result.video); })
      .catch(() => { if (!cancelled) setPrefetched(null); });
    if (queue.kind === "session" || queue.kind === "user-playlist" || queue.kind === "channel-playlist") {
      resolveNextVideo(queue, currentVideoId, direction, "previous")
        .then((result) => { if (!cancelled) setPrevious(result.video); })
        .catch(() => { if (!cancelled) setPrevious(null); });
    }
    return () => { cancelled = true; };
  }, [currentVideoId, direction, queue]);

  const show = useCallback(() => {
    if (prefetched) setVideo(prefetched);
  }, [prefetched]);

  // Running on through a list starts each entry where it begins; a feed hands
  // you a video you may well have left part-way through, and that position is
  // still yours.
  const queueState = useCallback(
    () => queue ? { state: { playbackQueue: queue, fromStart: isContinuousPlaylistQueue(queue) } } : undefined,
    [queue],
  );

  const playPrefetched = useCallback(() => {
    if (!prefetched) return;
    navigate(`/watch/${prefetched.video_id}`, queueState());
  }, [navigate, prefetched, queueState]);

  /**
   * The entry before this one. Nothing is prefetched for it: going back is a
   * deliberate act, rare enough to pay for its own lookup, and at the top of a
   * list there is simply nothing to go back to.
   */
  const playPrevious = useCallback(async () => {
    if (!queue || !currentVideoId) return;
    const resolved = await resolveNextVideo(queue, currentVideoId, direction === "newest" ? "oldest" : "newest")
      .catch(() => ({ video: null }));
    if (resolved.video) navigate(`/watch/${resolved.video.video_id}`, queueState());
  }, [currentVideoId, direction, navigate, queue, queueState]);

  const playPrevious = useCallback(() => {
    if (!previous) return;
    navigate(`/watch/${previous.video_id}`, queue ? { state: { playbackQueue: queue } } : undefined);
  }, [navigate, previous, queue]);

  const play = useCallback(() => {
    if (!video) return;
    navigate(`/watch/${video.video_id}`, queueState());
  }, [navigate, queueState, video]);

  const skip = useCallback(async () => {
    if (!video || !queue || loadingNext) return;
    const requestId = ++requestRef.current;
    setLoadingNext(true);
    try {
      const [result] = await Promise.all([
        resolveNextVideo(queue, video.video_id, direction),
        new Promise<void>((resolve) => window.setTimeout(resolve, 300)),
      ]);
      if (requestId === requestRef.current) setVideo(result.video);
    } catch {
      // Keep the current suggestion when resolving the following item fails.
    } finally {
      if (requestId === requestRef.current) setLoadingNext(false);
    }
  }, [direction, loadingNext, queue, video]);

  const dismiss = useCallback(() => {
    requestRef.current++;
    setLoadingNext(false);
    setVideo(null);
  }, []);

  return { dismiss, hasPrefetched: Boolean(prefetched), hasPrevious: Boolean(previous), loadingNext, play, playPrefetched, playPrevious, prefetched, previous, show, skip, video };
}
