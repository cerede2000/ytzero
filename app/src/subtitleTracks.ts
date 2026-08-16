import { callerWasRefused, cookieAttemptMemory } from "./cookieAttemptOrder";
import { downloadCookiesConfigured, srtToVtt, ytdlpCommand, ytdlpStatus } from "./downloader";
import { log } from "./logger";
import { dlSettings } from "./downloadConfig";
import { getUserSetting } from "./db";
import { SUBTITLE_LANGUAGE_CODES } from "./subtitleLanguages";
import { videoInfoRefusalQuiet } from "./youtubeRefusalQuiet";
import { potArgsFor } from "./ytdlpPotProvider";

/**
 * Subtitles, without keeping anything.
 *
 * YouTube serves each caption track as a signed URL of its own, in WebVTT if
 * asked. So a track is proxied the way the audio and the video are: resolved
 * once, then read straight through. Downloading one to disk first cost a
 * yt-dlp run per language and left a file behind that nothing ever collected.
 *
 * One resolution covers every language a video has: the signature is over the
 * address and the video, not over `lang`, so the tracks come back as a set.
 */

export interface SubtitleTrack {
  lang: string;
  /** How YouTube names it, e.g. "English (auto-generated)". */
  name: string;
  url: string;
  ext: string;
  automatic: boolean;
}

interface ResolvedTracks {
  tracks: SubtitleTrack[];
  expiresAt: number;
}

/** yt-dlp's shape: language → the same track offered in several formats. */
type CaptionMap = Record<string, Array<{ ext?: unknown; url?: unknown; name?: unknown }>>;

const TIMEDTEXT_HOSTS = new Set(["www.youtube.com", "youtube.com"]);
/** Kept for a while, then asked for again: the URLs carry their own expiry. */
const FALLBACK_TTL_MS = 30 * 60_000;
const MAX_VIDEOS = 64;

export function safeSubtitleUrl(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    // A caption track is served either from YouTube's timedtext endpoint or,
    // for some videos, from the media edge. Both are ours to read; anything
    // else is not something this proxy should be fetching.
    if (!TIMEDTEXT_HOSTS.has(host) && !host.endsWith(".googlevideo.com")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function expiryOf(url: string, now: number): number {
  const seconds = Number(url.match(/[?&/]expire[=/](\d+)/)?.[1]);
  if (Number.isFinite(seconds) && seconds > 0) return Math.max(now, seconds * 1000 - 60_000);
  return now + FALLBACK_TTL_MS;
}

/**
 * The one entry to read a language through.
 *
 * WebVTT is what a `<track>` element plays, so it comes first. YouTube also
 * offers the same language as an HLS playlist of caption segments — playable,
 * but not one file to hand over — so a plain timedtext URL is preferred to it.
 */
export function pickSubtitleEntry(entries: CaptionMap[string]): { url: string; ext: string } | null {
  const usable = entries.flatMap((entry) => {
    const ext = typeof entry.ext === "string" ? entry.ext : "";
    const url = typeof entry.url === "string" ? safeSubtitleUrl(entry.url) : null;
    if (!url || (ext !== "vtt" && ext !== "srt")) return [];
    return [{ url, ext, plain: !url.includes("/api/manifest/") }];
  });
  const chosen = usable.find((e) => e.ext === "vtt" && e.plain)
    ?? usable.find((e) => e.ext === "vtt")
    ?? usable.find((e) => e.plain)
    ?? usable[0];
  return chosen ? { url: chosen.url, ext: chosen.ext } : null;
}

/** A region (`BR`), a script (`Hans`) or a UN area code — a real place. */
const REAL_SUBTAG = /^([A-Za-z]{2}|[A-Za-z]{4}|\d{3})$/;

/**
 * The language someone would ask for.
 *
 * A video with more than one track in a language names them apart with an
 * opaque id — `fr-gqnk0mWVyHo` alongside `fr` — and that is not a language
 * anyone recognises: picking "Français" found nothing while an entry with a
 * machine's name for it sat below, and worked. A genuine regional code
 * (`pt-BR`, `zh-Hans`) is a language of its own and is left alone.
 */
export function askedLanguage(lang: string): string {
  const [base, ...rest] = lang.split("-");
  if (!base || rest.length === 0) return lang;
  return rest.every((subtag) => REAL_SUBTAG.test(subtag)) ? lang : base;
}

/**
 * The languages this profile has any use for.
 *
 * Machine captions come translated into everything: one video offered
 * seventy-one, of which the listener wanted one. Estonian and Kazakh on a
 * French video are a machine's translation of a machine's transcription, and
 * a menu of them is a menu nobody reads — worse, trying a few in a row is
 * what YouTube answers with 429.
 *
 * What is asked for is what has been said out loud: the captions language,
 * the player's, the interface's, and the ones downloads are configured to
 * keep. English closes the list when nothing else has been chosen.
 */
export function wantedSubtitleLanguages(said: Array<string | null | undefined>): Set<string> {
  const wanted = new Set<string>();
  for (const value of said) {
    for (const code of String(value ?? "").split(/[\s,]+/)) {
      const trimmed = code.trim();
      if (trimmed) wanted.add(trimmed);
    }
  }
  if (wanted.size === 0) wanted.add("en");
  return wanted;
}

/**
 * What yt-dlp printed, reduced to one track per language.
 *
 * A video's own captions are always offered, whatever language they are in.
 * Machine-generated ones are kept only where they were asked for.
 */
export function subtitleTracksFromMaps(
  subtitles: CaptionMap,
  automatic: CaptionMap,
  wanted: ReadonlySet<string> = SUBTITLE_LANGUAGE_CODES,
): SubtitleTrack[] {
  const tracks: SubtitleTrack[] = [];
  const take = (map: CaptionMap, automaticTrack: boolean) => {
    for (const [code, entries] of Object.entries(map ?? {})) {
      const lang = askedLanguage(code);
      if (!Array.isArray(entries)) continue;
      if (automaticTrack && !wanted.has(lang)) continue;
      const picked = pickSubtitleEntry(entries);
      if (!picked) continue;
      const named = entries.find((entry) => typeof entry.name === "string" && entry.name);
      tracks.push({
        lang,
        name: typeof named?.name === "string" ? named.name : lang,
        url: picked.url,
        ext: picked.ext,
        automatic: automaticTrack,
      });
    }
  };
  // What the author wrote first, so it is the one tried first for a language.
  take(subtitles, false);
  take(automatic, true);
  return tracks.sort((a, b) => a.lang.localeCompare(b.lang));
}

/**
 * The languages to put in the menu.
 *
 * A video with several audio tracks has a caption track for each, all in the
 * same language. They are the same language to whoever is choosing, so the
 * menu says it once; which of them actually answers is settled when one is
 * asked for.
 */
export function subtitleLanguages(tracks: readonly SubtitleTrack[]): string[] {
  return [...new Set(tracks.map((track) => track.lang))];
}

export function createSubtitleTracks({
  spawn = Bun.spawn,
  now = Date.now,
}: { spawn?: typeof Bun.spawn; now?: () => number } = {}) {
  const resolved = new Map<string, ResolvedTracks>();
  const inFlight = new Map<string, Promise<SubtitleTrack[]>>();
  const keyFor = (userId: number, videoId: string) => `${userId}:${videoId}`;

  async function attempt(userId: number, videoId: string, useCookies: boolean) {
    const args = [
      `https://www.youtube.com/watch?v=${videoId}`,
      "--ignore-config", "--no-playlist", "--no-warnings", "--skip-download",
      "--print", "%(subtitles)j",
      "--print", "%(automatic_captions)j",
      ...potArgsFor(useCookies),
    ];
    const process = spawn(ytdlpCommand(userId, args, useCookies), { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout as ReadableStream<Uint8Array>).text(),
      new Response(process.stderr as ReadableStream<Uint8Array>).text(),
      process.exited,
    ]);
    if (exitCode !== 0) return { tracks: [] as SubtitleTrack[], refused: callerWasRefused(stderr) };
    const [subtitles, automatic] = stdout.split(/\r?\n/).map((line) => {
      try { return JSON.parse(line) as CaptionMap; } catch { return {} as CaptionMap; }
    });
    const wanted = wantedSubtitleLanguages([
      getUserSetting(userId, "player_cc_lang"),
      getUserSetting(userId, "player_hl"),
      getUserSetting(userId, "language"),
      String((await dlSettings(userId) as { sub_langs?: unknown }).sub_langs ?? ""),
    ]);
    return { tracks: subtitleTracksFromMaps(subtitles ?? {}, automatic ?? {}, wanted), refused: false };
  }

  async function resolveFresh(userId: number, videoId: string): Promise<SubtitleTrack[]> {
    if (!(await ytdlpStatus())) return [];
    const startedAt = now();
    const order = cookieAttemptMemory.order(userId, downloadCookiesConfigured(userId), videoInfoRefusalQuiet.quiet());
    for (const useCookies of order) {
      const { tracks, refused } = await attempt(userId, videoId, useCookies).catch(
        () => ({ tracks: [] as SubtitleTrack[], refused: false }),
      );
      cookieAttemptMemory.record({ userId, useCookies, resolved: tracks.length > 0, refused });
      if (tracks.length === 0) continue;
      const expiresAt = tracks.reduce((soonest, track) => Math.min(soonest, expiryOf(track.url, now())), Infinity);
      while (resolved.size >= MAX_VIDEOS) {
        const oldest = resolved.keys().next().value as string | undefined;
        if (!oldest) break;
        resolved.delete(oldest);
      }
      resolved.set(keyFor(userId, videoId), { tracks, expiresAt });
      log.info("subtitles.tracks_resolved", {
        userId, videoId, usedCookies: useCookies, languages: tracks.length, ms: now() - startedAt,
      });
      return tracks;
    }
    log.info("subtitles.tracks_unavailable", { userId, videoId, ms: now() - startedAt });
    return [];
  }

  /** Every language this video has, resolved once and kept while it is valid. */
  function subtitleTracks(userId: number, videoId: string): Promise<SubtitleTrack[]> {
    const key = keyFor(userId, videoId);
    const cached = resolved.get(key);
    if (cached && cached.expiresAt > now()) return Promise.resolve(cached.tracks);
    if (cached) resolved.delete(key);
    const running = inFlight.get(key);
    if (running) return running;
    const started = resolveFresh(userId, videoId);
    inFlight.set(key, started);
    const forget = () => { if (inFlight.get(key) === started) inFlight.delete(key); };
    started.then(forget, forget);
    return started;
  }

  /**
   * What is already known, without going to ask.
   *
   * The player lists the languages as it mounts, on every video. That listing
   * must not be the thing that spends four seconds on yt-dlp — the listener
   * asking for a language is.
   */
  function knownSubtitleTracks(userId: number, videoId: string): SubtitleTrack[] {
    const cached = resolved.get(keyFor(userId, videoId));
    return cached && cached.expiresAt > now() ? cached.tracks : [];
  }

  function invalidateSubtitleTracks(videoId?: string): void {
    if (!videoId) return resolved.clear();
    for (const key of resolved.keys()) if (key.endsWith(`:${videoId}`)) resolved.delete(key);
  }

  return { subtitleTracks, knownSubtitleTracks, invalidateSubtitleTracks };
}

export const { subtitleTracks, knownSubtitleTracks, invalidateSubtitleTracks } = createSubtitleTracks();

/**
 * Asking for several tracks in a row is answered with 429, and it clears in
 * about a second and a half — measured against a track that came back empty
 * and then returned fifteen kilobytes. A listener choosing a language sees
 * that as "this one leads nowhere", so it is worth waiting out rather than
 * reporting.
 */
const RATE_LIMIT_DELAYS_MS = [400, 900, 1_500];

/** Read one track through, as the WebVTT a `<track>` element plays. */
export async function readSubtitleTrack(
  track: SubtitleTrack,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms),
): Promise<string | null> {
  const url = safeSubtitleUrl(track.url);
  if (!url) return null;
  for (const delay of [0, ...RATE_LIMIT_DELAYS_MS]) {
    if (delay) await wait(delay);
    if (signal?.aborted) return null;
    const response = await fetchImpl(url, { signal }).catch(() => null);
    if (response?.status === 429) {
      await response.body?.cancel().catch(() => {});
      log.info("subtitles.rate_limited", { lang: track.lang, afterMs: delay });
      continue;
    }
    if (!response?.ok) {
      await response?.body?.cancel().catch(() => {});
      return null;
    }
    const text = await response.text().catch(() => null);
    if (!text?.trim()) return null;
    return track.ext === "srt" ? srtToVtt(text) : text;
  }
  return null;
}
