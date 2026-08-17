import { getUserSetting } from "./db";
import { log } from "./logger";
import { forgetRelatedVideos, readRelatedVideos, saveRelatedVideos } from "./relatedVideoStore";
import type { RelatedVideo } from "./relatedVideos";
import { fetchRelatedVideosAsSomebody, fetchVideoInfo } from "./youtube";
import { fetchWatchNextPanel } from "./youtubeInnerTube";
import { panelLanguage } from "./relatedVideoText";
import { youtubeCookieHeader } from "./youtubeCookieHeader";
import { persistSetCookies, recordCookieRecognition } from "./youtubeCookieHealth";
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
/** Whose question the panel answers. */
export type RelatedSource = "video" | "personal" | "account";

const inFlight = new Map<string, Promise<RelatedVideo[]>>();
/** A video YouTube gave nothing for is not asked about again this soon. */
const REFUSED_QUIET_MS = 6 * 60 * 60_000;
const emptyAt = new Map<string, number>();

/**
 * The panels that could not be written down.
 *
 * A panel is stored against the video's library row, and a video opened from
 * somebody's panel has no row until its import finishes — or ever, if the
 * import fails. Every ask therefore found nothing stored and bought another
 * request: three signed-in fetches of the same watch page in twelve seconds,
 * on an address that was already being refused.
 *
 * So the answer is remembered here for as long as a stored one would live,
 * and the store remains the durable copy for videos that have a row.
 */
const PANEL_MEMORY_MS = 24 * 60 * 60_000;
const MEMORY_LIMIT = 200;
const remembered = new Map<string, { at: number; videos: RelatedVideo[] }>();

function recall(key: string, now: () => number): RelatedVideo[] | null {
  const held = remembered.get(key);
  if (!held) return null;
  if (now() - held.at > PANEL_MEMORY_MS) {
    remembered.delete(key);
    return null;
  }
  return held.videos;
}

function remember(key: string, videos: RelatedVideo[], now: () => number): void {
  remembered.set(key, { at: now(), videos });
  // Map keeps insertion order, so the first key is the oldest written.
  while (remembered.size > MEMORY_LIMIT) {
    const oldest = remembered.keys().next().value;
    if (oldest === undefined) break;
    remembered.delete(oldest);
  }
}

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
  loadAsSomebody = async (videoId: string, userId: number, session?: { signedIn: boolean; setCookies: string[] }): Promise<RelatedVideo[]> => {
    const cookieHeader = cookieHeaderFor(userId);
    if (!cookieHeader) return [];
    const videos = await fetchRelatedVideosAsSomebody(videoId, cookieHeader, panelLanguage(getUserSetting(userId, "language")), session);
    if (session) {
      recordCookieRecognition(userId, session.signedIn);
      persistSetCookies(userId, session.setCookies);
    }
    return videos;
  },
  forget = forgetRelatedVideos,
  /** The panel youtube.com itself shows: the video's, seen by this account. */
  asBrowser = async (videoId: string, userId: number): Promise<RelatedVideo[]> => {
    const cookieHeader = cookieHeaderFor(userId);
    if (!cookieHeader) return [];
    return fetchWatchNextPanel(videoId, cookieHeader, panelLanguage(getUserSetting(userId, "language")));
  },
) {
  return async function fetchRelatedVideos(videoId: string, userId: number, refresh = false, source: RelatedSource = "video"): Promise<RelatedVideo[]> {
    const key = `${userId}:${videoId}`;
    // Asking again is what the reader just pressed. Nothing stored, nothing
    // remembered about an empty answer, and no sharing with a request that was
    // already running under the old answer.
    if (refresh) {
      await forget(videoId, userId);
      emptyAt.delete(key);
      remembered.delete(key);
    } else {
      const stored = await read(videoId, userId, 25);
      if (stored.length > 0) return stored;
      const held = recall(key, now);
      if (held) return held;
      const running = inFlight.get(key);
      if (running) return running;
      const quietSince = emptyAt.get(key);
      if (quietSince !== undefined && now() - quietSince < REFUSED_QUIET_MS) return [];
    }

    const started = (async () => {
      /*
       * Whose question this is.
       *
       * Asked as nobody, YouTube answers about the video: a documentary on
       * IMAX is answered with two more on IMAX, measured on two unrelated
       * videos. Asked as an account, it answers about the account — closer to
       * that person's habits, and much the same list whichever video was
       * opened, which is not what a panel beside a video is for.
       *
       * Neither is wrong, so neither is hard-coded: the reader says which
       * question is theirs. A profile with no jar of its own returns from the
       * account attempt at once, having asked nothing.
       */
      const recognised = { signedIn: false, setCookies: [] as string[] };
      const asAccount = () => loadAsSomebody(videoId, userId, recognised).catch((failure) => {
        log.warn("related.credentialed_fetch_failed", { videoId, userId, error: failure instanceof Error ? failure.message : String(failure) });
        return [] as RelatedVideo[];
      });
      const mine = source === "account" ? await asAccount()
        : source === "personal" ? await asBrowser(videoId, userId).catch((failure) => {
            log.warn("related.watch_next_failed", { videoId, userId, error: failure instanceof Error ? failure.message : String(failure) });
            return [] as RelatedVideo[];
          })
        : [];
      if (mine.length > 0) {
        remember(key, mine, now);
        await save(videoId, userId, mine);
        // `recognised` is the answer; `credentialed` was only the attempt.
        log.info("related.fetched", { videoId, userId, suggestions: mine.length, source, recognised: recognised.signedIn });
        return mine;
      }

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
        // over a refusal that lasts ninety seconds. The account can still be
        // asked — being known is what gets an answer from a refused address —
        // even when the reader would rather the panel were about the video.
        const authenticated = source === "video"
          ? await loadAsSomebody(videoId, userId, recognised).catch(() => [] as RelatedVideo[])
          : [];
        if (authenticated.length > 0) {
          remember(key, authenticated, now);
          await save(videoId, userId, authenticated);
          log.info("related.fetched", { videoId, userId, suggestions: authenticated.length, credentialed: true, recognised: recognised.signedIn });
          return authenticated;
        }
        log.info("related.unavailable_while_refused", { videoId, userId });
        return [];
      }
      if (related.videos.length === 0) {
        emptyAt.set(key, now());
        return [];
      }
      remember(key, related.videos, now);
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
