import { getUserSetting } from "./db";
import { log } from "./logger";
import { forgetRelatedVideos, readRelatedVideos, saveRelatedVideos } from "./relatedVideoStore";
import type { RelatedVideo } from "./relatedVideos";
import { fetchRelatedVideosAsSomebody, fetchVideoInfo } from "./youtube";
import { panelLanguage } from "./relatedVideoText";
import { youtubeCookieHeader } from "./youtubeCookieHeader";
import { isYouTubeRefusal } from "./youtubeRefusalQuiet";

/**
 * Fetch the panel a profile should see beside a video.
 *
 * Reading it at import time is free, and covers every video arriving from now
 * on. It covers nothing already in the library: those rows were written long
 * before there was anywhere to put a panel, and for a library of any size that
 * is most of what anyone opens — which is why the feature looked like it
 * worked only sometimes.
 *
 * So a video with no panel is allowed one request, and only when somebody is
 * looking at it. `force` because the answer may well be a ten-minute-old cache
 * entry, and a cached answer is exactly the one that carries no page to read
 * the panel out of.
 */
const inFlight = new Map<string, Promise<RelatedVideo[]>>();
/** A video YouTube gave nothing for is not asked about again this soon. */
const REFUSED_QUIET_MS = 6 * 60 * 60_000;
const emptyAt = new Map<string, number>();

/**
 * Only this profile's own credentials, and never anybody else's.
 *
 * Metadata can be fetched with a borrowed jar: a title and a duration are the
 * video's, not the account's. A panel of suggestions is the opposite — it is
 * assembled from what that account watches, so borrowing hands one person's
 * viewing habits to another and, once stored, to whoever opens the video next.
 * A profile with no jar gets no panel from YouTube, which is the honest answer.
 */
function cookieHeaderFor(userId: number): string | null {
  return youtubeCookieHeader(userId);
}

export function createRelatedVideoFetcher(
  read = readRelatedVideos,
  save = saveRelatedVideos,
  // Asked for in the reader's own language: the title is the one thing taken
  // from the panel verbatim, and YouTube auto-translates it to whatever the
  // request asks for.
  load = (videoId: string, related: { videos: RelatedVideo[] }, userId: number) =>
    fetchVideoInfo(videoId, { force: true, related, language: panelLanguage(getUserSetting(userId, "language")) }),
  now: () => number = Date.now,
  loadAsSomebody = async (videoId: string, userId: number): Promise<RelatedVideo[]> => {
    const cookieHeader = cookieHeaderFor(userId);
    if (!cookieHeader) return [];
    return fetchRelatedVideosAsSomebody(videoId, cookieHeader, panelLanguage(getUserSetting(userId, "language")));
  },
  forget = forgetRelatedVideos,
) {
  return async function fetchRelatedVideos(videoId: string, userId: number, refresh = false): Promise<RelatedVideo[]> {
    const key = `${userId}:${videoId}`;
    // Asking again is what the reader just pressed. Nothing stored, nothing
    // remembered about an empty answer, and no sharing with a request that was
    // already running under the old answer.
    if (refresh) {
      await forget(videoId, userId);
      emptyAt.delete(key);
    } else {
      const stored = await read(videoId, userId, 25);
      if (stored.length > 0) return stored;
      const running = inFlight.get(key);
      if (running) return running;
      const quietSince = emptyAt.get(key);
      if (quietSince !== undefined && now() - quietSince < REFUSED_QUIET_MS) return [];
    }

    const started = (async () => {
      /*
       * The reader's own account first, whenever they have lent one.
       *
       * A panel is assembled from what an account watches — that is the whole
       * of what separates a recommendation from a list of what is popular
       * nearby. Treating the credentials as a fallback for a refused address
       * meant they were used only when YouTube was turning us away: the moment
       * the address recovered, everyone silently went back to the panel
       * YouTube shows a stranger. Same profile, same cookies, and a panel that
       * had nothing to do with the reader.
       *
       * A profile with no jar of its own returns from here at once, having
       * asked nothing.
       */
      const mine = await loadAsSomebody(videoId, userId).catch((failure) => {
        log.warn("related.credentialed_fetch_failed", { videoId, userId, error: failure instanceof Error ? failure.message : String(failure) });
        return [] as RelatedVideo[];
      });
      if (mine.length > 0) {
        await save(videoId, userId, mine);
        log.info("related.fetched", { videoId, userId, suggestions: mine.length, credentialed: true });
        return mine;
      }

      // Otherwise the panel YouTube shows a stranger: about the video rather
      // than about a person, which is the honest answer for a profile that has
      // lent no account.
      const related: { videos: RelatedVideo[] } = { videos: [] };
      try {
        await load(videoId, related, userId);
      } catch (error) {
        if (!isYouTubeRefusal(error)) {
          log.warn("related.fetch_failed", { videoId, userId, error: error instanceof Error ? error.message : String(error) });
          emptyAt.set(key, now());
          return [];
        }
        // A refusal answers nothing about this video: the question was never
        // put. Remembering it as empty would hold the panel shut for six hours
        // over a refusal that lasts ninety seconds.
        log.info("related.unavailable_while_refused", { videoId, userId });
        return [];
      }
      if (related.videos.length === 0) {
        emptyAt.set(key, now());
        return [];
      }
      await save(videoId, userId, related.videos);
      log.info("related.fetched", { videoId, userId, suggestions: related.videos.length });
      return related.videos;
    })();

    inFlight.set(key, started);
    const forgetInFlight = () => { if (inFlight.get(key) === started) inFlight.delete(key); };
    started.then(forgetInFlight, forgetInFlight);
    return started;
  };
}

export const fetchRelatedVideos = createRelatedVideoFetcher();
