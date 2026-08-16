import { callerWasRefused, cookieAttemptMemory } from "./cookieAttemptOrder";
import { downloadCookiesConfigured, srtToVtt, ytdlpCommand, ytdlpStatus } from "./downloader";
import { log } from "./logger";
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

/**
 * What yt-dlp printed, reduced to one track per language.
 *
 * A video's own captions are always offered. Machine-generated ones are not:
 * YouTube lists a hundred and sixty translations of them, which is a menu
 * nobody reads, so only the languages this app offers are kept.
 */
export function subtitleTracksFromMaps(
  subtitles: CaptionMap,
  automatic: CaptionMap,
  supported: ReadonlySet<string> = SUBTITLE_LANGUAGE_CODES,
): SubtitleTrack[] {
  const byLang = new Map<string, SubtitleTrack>();
  const take = (map: CaptionMap, automaticTrack: boolean) => {
    for (const [lang, entries] of Object.entries(map ?? {})) {
      if (!Array.isArray(entries) || byLang.has(lang)) continue;
      if (automaticTrack && !supported.has(lang)) continue;
      const picked = pickSubtitleEntry(entries);
      if (!picked) continue;
      const named = entries.find((entry) => typeof entry.name === "string" && entry.name);
      byLang.set(lang, {
        lang,
        name: typeof named?.name === "string" ? named.name : lang,
        url: picked.url,
        ext: picked.ext,
        automatic: automaticTrack,
      });
    }
  };
  take(subtitles, false);
  take(automatic, true);
  return [...byLang.values()].sort((a, b) => a.lang.localeCompare(b.lang));
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
    return { tracks: subtitleTracksFromMaps(subtitles ?? {}, automatic ?? {}), refused: false };
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

/** Read one track through, as the WebVTT a `<track>` element plays. */
export async function readSubtitleTrack(
  track: SubtitleTrack,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const url = safeSubtitleUrl(track.url);
  if (!url) return null;
  const response = await fetchImpl(url, { signal }).catch(() => null);
  if (!response?.ok) {
    await response?.body?.cancel().catch(() => {});
    return null;
  }
  const text = await response.text().catch(() => null);
  if (!text?.trim()) return null;
  return track.ext === "srt" ? srtToVtt(text) : text;
}
