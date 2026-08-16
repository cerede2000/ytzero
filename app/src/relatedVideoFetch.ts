import { log } from "./logger";
import { readRelatedVideos, saveRelatedVideos } from "./relatedVideoStore";
import type { RelatedVideo } from "./relatedVideos";
import { fetchVideoInfo } from "./youtube";
import { YouTubeRefusingError } from "./youtubeRefusalQuiet";

/**
 * Fetch the panel for a video that never had one.
 *
 * Reading it at import time is free, and covers every video arriving from now
 * on. It covers nothing already in the library: those rows were written long
 * before there was anywhere to put a panel, and for a library of any size that
 * is most of what anyone opens — which is why the feature looked like it
 * worked only sometimes.
 *
 * So a video with no panel is allowed one request, ever, and only when
 * somebody is looking at it. `force` because the answer may well be a
 * ten-minute-old cache entry, and a cached answer is exactly the one that
 * carries no page to read the panel out of.
 */
const inFlight = new Map<string, Promise<RelatedVideo[]>>();
/** A video YouTube gave nothing for is not asked about again this soon. */
const REFUSED_QUIET_MS = 6 * 60 * 60_000;
const emptyAt = new Map<string, number>();

export function createRelatedVideoFetcher(
  read = readRelatedVideos,
  save = saveRelatedVideos,
  load = (videoId: string, related: { videos: RelatedVideo[] }) => fetchVideoInfo(videoId, { force: true, related }),
  now: () => number = Date.now,
) {
  return async function fetchRelatedVideos(videoId: string): Promise<RelatedVideo[]> {
    const stored = await read(videoId, 25);
    if (stored.length > 0) return stored;
    const running = inFlight.get(videoId);
    if (running) return running;
    const quietSince = emptyAt.get(videoId);
    if (quietSince !== undefined && now() - quietSince < REFUSED_QUIET_MS) return [];

    const started = (async () => {
      const related: { videos: RelatedVideo[] } = { videos: [] };
      try {
        await load(videoId, related);
      } catch (error) {
        // A refused address is already saying so once, loudly, elsewhere.
        if (!(error instanceof YouTubeRefusingError)) {
          log.warn("related.fetch_failed", { videoId, error: error instanceof Error ? error.message : String(error) });
        }
        emptyAt.set(videoId, now());
        return [];
      }
      if (related.videos.length === 0) {
        emptyAt.set(videoId, now());
        return [];
      }
      await save(videoId, related.videos);
      log.info("related.fetched", { videoId, suggestions: related.videos.length });
      return related.videos;
    })();

    inFlight.set(videoId, started);
    const forget = () => { if (inFlight.get(videoId) === started) inFlight.delete(videoId); };
    started.then(forget, forget);
    return started;
  };
}

export const fetchRelatedVideos = createRelatedVideoFetcher();
