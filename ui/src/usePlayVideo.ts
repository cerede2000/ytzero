import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { Video } from "./apiTypes";
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
        // What the card was already showing. A video that is not in the
        // library has to be imported before the page knows anything about it,
        // and that takes as long as it takes — but the title, the channel and
        // the thumbnail were on screen a moment ago, so there is no reason to
        // stare at an empty page while it happens.
        preview: {
          videoId: video.video_id,
          title: video.title,
          channelId: video.channel_id,
          channelTitle: video.channel_title,
          thumbnail: video.thumbnail,
          duration: video.duration ?? null,
        },
      },
    },
  ), [navigate]);
}
