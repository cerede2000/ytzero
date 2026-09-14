import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { Video } from "./apiTypes";
import { createWatchRoutePreview } from "./pages/watchRuntime";
import type { PlaybackQueueContext, PlayOptions, PlayVideo } from "./playbackQueue";

/**
 * Open a video the way every other part of the app opens one.
 *
 * Starting playback is a navigation carrying three things the watch page cannot
 * work out for itself: the queue this video belongs to, whether the position
 * remembered inside it still applies, and whether to open in audio. Written out
 * a second time somewhere else, one of the three gets forgotten — which is how
 * a button ends up playing the right video with the wrong queue, or in video
 * when audio was asked for.
 */
export function usePlayVideo(): PlayVideo {
  const navigate = useNavigate();
  return useCallback((video: Video, playbackQueue?: PlaybackQueueContext, options?: PlayOptions) => navigate(
    `/watch/${video.video_id}`,
    {
      state: {
        playbackQueue,
        fromStart: options?.fromStart,
        audio: options?.audio,
        // What the card was already showing, so the page is not empty while a
        // video that is not in the library yet is imported.
        watchPreview: createWatchRoutePreview(video),
      },
    },
  ), [navigate]);
}
