import { log } from "./logger";
import { metadataCredentialProfile } from "./metadataCredentials";
import { readRelatedVideos, saveRelatedVideos } from "./relatedVideoStore";
import type { RelatedVideo } from "./relatedVideos";
import { fetchRelatedVideosAsSomebody, fetchVideoInfo } from "./youtube";
import { youtubeCookieHeader } from "./youtubeCookieHeader";
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

/**
 * The profile whose cookies may ask on the instance's behalf.
 *
 * The one looking at the video first, since the request is made for them and
 * it is their own account it would be attributed to. Failing that, the same
 * profile the background jobs borrow — the panel is no more sensitive than the
 * metadata those already fetch.
 */
async function cookieHeaderFor(userId: number | undefined): Promise<string | null> {
  const own = userId === undefined ? null : youtubeCookieHeader(userId);
  if (own) return own;
  const borrowed = await metadataCredentialProfile();
  return borrowed == null || borrowed === userId ? null : youtubeCookieHeader(borrowed);
}

export function createRelatedVideoFetcher(
  read = readRelatedVideos,
  save = saveRelatedVideos,
  load = (videoId: string, related: { videos: RelatedVideo[] }) => fetchVideoInfo(videoId, { force: true, related }),
  now: () => number = Date.now,
  loadAsSomebody = async (videoId: string, userId: number | undefined): Promise<RelatedVideo[]> => {
    const cookieHeader = await cookieHeaderFor(userId);
    if (!cookieHeader) return [];
    return fetchRelatedVideosAsSomebody(videoId, cookieHeader);
  },
) {
  return async function fetchRelatedVideos(videoId: string, userId?: number): Promise<RelatedVideo[]> {
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
        if (!(error instanceof YouTubeRefusingError)) {
          log.warn("related.fetch_failed", { videoId, error: error instanceof Error ? error.message : String(error) });
          emptyAt.set(videoId, now());
          return [];
        }
        // A refusal answers nothing about this video: the question was never
        // put. Remembering it as empty would hold the panel shut for six hours
        // over a refusal that lasts ninety seconds.
        const authenticated = await loadAsSomebody(videoId, userId).catch((failure) => {
          log.warn("related.credentialed_fetch_failed", { videoId, error: failure instanceof Error ? failure.message : String(failure) });
          return [] as RelatedVideo[];
        });
        if (authenticated.length === 0) {
          log.info("related.unavailable_while_refused", { videoId });
          return [];
        }
        await save(videoId, authenticated);
        log.info("related.fetched", { videoId, suggestions: authenticated.length, credentialed: true });
        return authenticated;
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
