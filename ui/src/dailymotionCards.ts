import type { SearchResult, Video } from "./apiTypes";
import { dailymotionClock } from "./dailymotionTypes";
import { videoFromSearchResult } from "./searchResultVideo";

export interface DailymotionCardSource {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  durationSeconds: number | null;
  publishedAt: string | null;
  views: number | null;
}

/**
 * A Dailymotion video described as the card every shelf already draws.
 *
 * Through the search-result shape rather than a second conversion of its own:
 * the card asks for a library video, one translation of that already exists,
 * and two would drift. Nothing is claimed about the library — no row, no
 * download, no history — only what Dailymotion answered and where this reader
 * got to, which is what a shelf of things to carry on with is made of.
 */
export function videoFromDailymotion(
  source: DailymotionCardSource,
  progress: { positionSeconds: number; durationSeconds: number } | null,
  now = Date.now(),
): Video {
  const result: SearchResult = {
    videoId: source.videoId,
    title: source.title,
    thumbnail: source.thumbnail,
    duration: dailymotionClock(source.durationSeconds ?? 0),
    channelId: null,
    channelTitle: source.channelTitle,
    channelAvatar: null,
    viewCount: source.views,
    published: null,
    publishedAt: source.publishedAt,
    watched: 0,
    watch_position: progress ? progress.positionSeconds : null,
    watch_duration: progress ? progress.durationSeconds : null,
    in_library: 0,
  };
  return videoFromSearchResult(result, { downloadsAllowed: false, downloadsEnabled: false, now });
}
