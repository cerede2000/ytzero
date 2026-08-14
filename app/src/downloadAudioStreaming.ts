import {
  audioRangeHeader,
  parseAudioRange,
  parseAudioUnsatisfiedTotal,
  validateAudioRangeResponse,
  type AudioByteRange,
} from "./audioRange";
import { defaultAudioDiagnostic, type AudioDiagnostic } from "./audioDiagnostics";
import { audioSourceKey } from "./audioSourceCache";
import { createAudioSourceResolver, type AudioSource } from "./audioSourceResolver";
import { googleVideoHost, safeGoogleVideoUrl } from "./audioUpstreamUrl";
import { createDownloadAudioVodStreaming } from "./downloadAudioVodStreaming";
import { rangedYtdlpHeaders } from "./ytdlpHttpHeaders";

interface DownloadAudioStreamingDependencies {
  YTDLP: string;
  downloadCookiesConfigured: (userId: number) => boolean;
  downloadCookiesFile: (userId: number) => string;
  ytdlpStatus: () => Promise<string | null>;
  audioDiagnostic?: AudioDiagnostic;
  fetchImpl?: typeof fetch;
  spawn?: typeof Bun.spawn;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}

const AUDIO_REQUEST_TIMEOUT_MS = 45_000;
const AUDIO_REDIRECT_LIMIT = 4;
const AUDIO_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/**
 * How long a source that keeps being refused is left alone. Short: a refusal
 * here is often not final — the same video plays a moment later — so this is
 * there to stop a storm of retries, not to give up on a track.
 */
const REFUSAL_QUIET_MS = 10_000;
/** A single refusal is worth another go; two in a row are worth pausing on. */
const REFUSALS_BEFORE_QUIET = 2;
/** Statuses that say the caller is the problem, so retrying changes nothing. */
const AUDIO_REFUSAL_STATUSES = new Set([401, 403, 429]);
/**
 * How long to wait before asking a refused URL again, per attempt.
 *
 * A freshly signed googlevideo URL is not usable the instant it is issued.
 * Measured in the container: every request in the first second is answered 403
 * — sequentially, concurrently, with or without a user agent, whatever range —
 * and the same URL then serves 206 in forty milliseconds. A first bench missed
 * this by spending four seconds resolving a second value before it fetched,
 * which is exactly the pause that made it work.
 *
 * So there is nothing to fix in the request: there is a moment to wait for.
 * Re-resolving is the expensive way to wait — six seconds of yt-dlp for a URL
 * that will be just as new — and asking again is the cheap way. The ladder is
 * dense at the start because the opening is measured in hundreds of
 * milliseconds, and a request nobody reads costs a few kilobytes while waiting
 * costs the listener silence.
 */
const AUDIO_RETRY_DELAYS_MS = [250, 400, 650, 1_000, 1_500, 2_200];

export function createDownloadAudioStreaming(dependencies: DownloadAudioStreamingDependencies) {
  const {
    audioDiagnostic = defaultAudioDiagnostic,
    fetchImpl = fetch,
    now = Date.now,
    wait = (milliseconds: number) => Bun.sleep(milliseconds),
  } = dependencies;
  /** Videos whose upstream refused us: how many times in a row, and when. */
  const refusals = new Map<string, { at: number; strikes: number }>();

  /** True while a video has been refused often enough to stop asking for now. */
  function refusalQuiet(userId: number, videoId: string): boolean {
    const refusal = refusals.get(audioSourceKey(userId, videoId));
    if (!refusal || refusal.strikes < REFUSALS_BEFORE_QUIET) return false;
    if (now() - refusal.at >= REFUSAL_QUIET_MS) return false;
    audioDiagnostic("info", "audio.source_quiet", {
      userId, videoId, sinceMs: now() - refusal.at, strikes: refusal.strikes,
    });
    return true;
  }
  const {
    discardAudioSource,
    invalidateAudioSources: invalidateResolvedAudioSources,
    primeAudioSource,
    refreshAudioSource,
    resolveAudioSource,
    retryAudioSource: retryResolvedAudioSource,
  } = createAudioSourceResolver(dependencies);

  function rangeNotSatisfiable(total?: number): Response {
    const headers = new Headers({ "Accept-Ranges": "bytes", "Cache-Control": "no-store" });
    if (total != null) headers.set("Content-Range", `bytes */${total}`);
    return new Response(null, { status: 416, headers });
  }

  function requestAbortSignal(parent?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
    const controller = new AbortController();
    const abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) abort();
    else parent?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("audio proxy timeout")), AUDIO_REQUEST_TIMEOUT_MS);
    return {
      signal: controller.signal,
      dispose: () => {
        clearTimeout(timer);
        parent?.removeEventListener("abort", abort);
      },
    };
  }

  interface ValidatedAudioUpstream {
    source: AudioSource;
    response: Response;
    contentRange: { start: number; end: number; total: number };
    contentLength: number;
  }

  type AudioUpstreamResult =
    | { kind: "ok"; value: ValidatedAudioUpstream }
    | { kind: "response"; value: Response }
    | null;

  async function fetchAudioUpstream(
    userId: number,
    videoId: string,
    source: AudioSource,
    range: AudioByteRange,
    signal: AbortSignal,
    sourceHeaders?: Record<string, string>,
  ): Promise<Response | null> {
    let currentUrl = source.url;
    for (let hop = 0; hop <= AUDIO_REDIRECT_LIMIT; hop++) {
      let response: Response;
      try {
        response = await fetchImpl(currentUrl, {
          headers: rangedYtdlpHeaders(source.httpHeaders, audioRangeHeader(range)),
          redirect: "manual",
          signal,
        });
      } catch {
        if (!signal.aborted) audioDiagnostic("warn", "audio.upstream_failed", {
          userId, videoId, reason: "network_error", rangeStart: range.start, rangeEnd: range.end,
        });
        return null;
      }

      if (!AUDIO_REDIRECT_STATUSES.has(response.status)) return response;
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (hop === AUDIO_REDIRECT_LIMIT) {
        audioDiagnostic("warn", "audio.upstream_failed", {
          userId, videoId, reason: "redirect_limit", status: response.status, redirects: hop + 1,
        });
        return null;
      }
      const nextUrl = location ? safeGoogleVideoUrl(location, currentUrl) : null;
      if (!nextUrl) {
        audioDiagnostic("warn", "audio.upstream_failed", {
          userId, videoId, reason: "redirect_rejected", status: response.status, redirects: hop + 1,
        });
        return null;
      }
      audioDiagnostic("info", "audio.upstream_redirect", {
        userId,
        videoId,
        status: response.status,
        redirects: hop + 1,
        fromHost: googleVideoHost(currentUrl),
        toHost: googleVideoHost(nextUrl),
      });
      currentUrl = nextUrl;
    }
    return null;
  }

  /** Ask for a range, waiting out a refusal rather than paying to re-resolve. */
  async function askUpstream(
    userId: number,
    videoId: string,
    source: AudioSource,
    range: AudioByteRange,
    signal: AbortSignal,
  ): Promise<Response | null> {
    let response = await fetchAudioUpstream(userId, videoId, source, range, signal);
    for (const delay of AUDIO_RETRY_DELAYS_MS) {
      if (!response || !AUDIO_REFUSAL_STATUSES.has(response.status) || signal.aborted) return response;
      await response.body?.cancel().catch(() => {});
      await wait(delay);
      if (signal.aborted) return null;
      audioDiagnostic("info", "audio.upstream_not_ready_yet", {
        userId, videoId, status: response.status, afterMs: delay,
      });
      response = await fetchAudioUpstream(userId, videoId, source, range, signal);
    }
    return response;
  }

  async function validatedAudioUpstream(
    userId: number,
    videoId: string,
    range: AudioByteRange,
    signal: AbortSignal,
  ): Promise<AudioUpstreamResult> {
    const refusedKey = audioSourceKey(userId, videoId);
    if (refusalQuiet(userId, videoId)) return null;
    let source = await resolveAudioSource(userId, videoId, signal);
    if (!source) return null;

    let upstream = await askUpstream(userId, videoId, source, range, signal);
    // Every delay spent and still refused: the URL itself may be the problem
    // after all — an expired one answers the same way — so resolve once more.
    if (upstream && AUDIO_REFUSAL_STATUSES.has(upstream.status) && !signal.aborted) {
      audioDiagnostic("info", "audio.source_refresh", {
        userId, videoId, reason: "upstream_status", status: upstream.status,
      });
      await upstream.body?.cancel().catch(() => {});
      source = await refreshAudioSource(userId, videoId, source.url, signal);
      if (!source) return null;
      upstream = await askUpstream(userId, videoId, source, range, signal);
    }
    if (!upstream) {
      if (!signal.aborted) discardAudioSource(userId, videoId, source.url);
      return null;
    }

    if (upstream.status === 416) {
      const total = parseAudioUnsatisfiedTotal(upstream.headers.get("content-range"));
      await upstream.body?.cancel().catch(() => {});
      return { kind: "response", value: rangeNotSatisfiable(total ?? undefined) };
    }
    if (upstream.status !== 206 || !upstream.body) {
      audioDiagnostic("warn", "audio.upstream_failed", {
        userId,
        videoId,
        reason: upstream.body ? "unexpected_status" : "missing_body",
        status: upstream.status,
        rangeStart: range.start,
        rangeEnd: range.end,
      });
      await upstream.body?.cancel().catch(() => {});
      if (!signal.aborted) {
        discardAudioSource(userId, videoId, source.url);
        // A refusal that survived a re-resolve is not a stale URL — it is a
        // refusal of us, and asking yt-dlp again produces the same one. A
        // player retrying every couple of seconds would turn that into a
        // stream of requests aimed at a host that has already said no, which
        // is how an address stays refused. Other failures still re-resolve:
        // a server error often means the node, not the caller.
        if (AUDIO_REFUSAL_STATUSES.has(upstream.status)) {
          for (const [key, refusal] of refusals) {
            if (now() - refusal.at >= REFUSAL_QUIET_MS) refusals.delete(key);
          }
          const previous = refusals.get(refusedKey);
          const strikes = previous && now() - previous.at < REFUSAL_QUIET_MS ? previous.strikes + 1 : 1;
          refusals.set(refusedKey, { at: now(), strikes });
        }
      }
      return null;
    }

    const contentRange = validateAudioRangeResponse(
      upstream.status,
      upstream.headers.get("content-range"),
      upstream.headers.get("content-length"),
      range,
    );
    if (!contentRange) {
      audioDiagnostic("warn", "audio.upstream_failed", {
        userId,
        videoId,
        reason: "invalid_range_headers",
        status: upstream.status,
        contentRange: upstream.headers.get("content-range"),
        contentLength: upstream.headers.get("content-length"),
        rangeStart: range.start,
        rangeEnd: range.end,
      });
      await upstream.body.cancel().catch(() => {});
      if (!signal.aborted) discardAudioSource(userId, videoId, source.url);
      return null;
    }
    const expectedLength = contentRange.end - contentRange.start + 1;
    return { kind: "ok", value: { source, response: upstream, contentRange, contentLength: expectedLength } };
  }

  /** Proxy one verified, bounded audio chunk with an explicit Content-Length. */
  async function getAudioResponse(
    userId: number,
    videoId: string,
    range: string | null,
    signal?: AbortSignal,
  ): Promise<Response | null> {
    const parsed = parseAudioRange(range);
    if (!parsed) return rangeNotSatisfiable();
    const operation = requestAbortSignal(signal);
    try {
      const result = await validatedAudioUpstream(userId, videoId, parsed, operation.signal);
      if (!result) return null;
      if (result.kind === "response") return result.value;
      const { source, response, contentRange, contentLength } = result.value;
      const body = await response.arrayBuffer().catch(() => null);
      if (!body || body.byteLength !== contentLength || operation.signal.aborted) {
        if (!operation.signal.aborted) {
          audioDiagnostic("warn", "audio.upstream_failed", {
            userId,
            videoId,
            reason: body ? "body_length_mismatch" : "body_read_failed",
            expectedLength: contentLength,
            receivedLength: body?.byteLength,
          });
          discardAudioSource(userId, videoId, source.url);
        }
        return null;
      }
      return new Response(body, {
        status: 206,
        headers: {
          "Content-Type": source.mime,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
          "Content-Length": String(contentLength),
          "Content-Range": `bytes ${contentRange.start}-${contentRange.end}/${contentRange.total}`,
        },
      });
    } finally {
      operation.dispose();
    }
  }

  async function readAudioPrefix(
    userId: number,
    videoId: string,
    bytes: number,
    signal: AbortSignal,
  ): Promise<{ bytes: Uint8Array; source: AudioSource; total: number } | null> {
    if (!Number.isSafeInteger(bytes) || bytes <= 0) return null;
    const operation = requestAbortSignal(signal);
    try {
      const range: AudioByteRange = { start: 0, end: bytes - 1, requested: true };
      const result = await validatedAudioUpstream(userId, videoId, range, operation.signal);
      if (!result || result.kind === "response") return null;
      const { source, response, contentRange, contentLength } = result.value;
      const body = await response.arrayBuffer().catch(() => null);
      if (!body || body.byteLength !== contentLength || operation.signal.aborted) {
        if (!operation.signal.aborted) {
          audioDiagnostic("warn", "audio.upstream_failed", {
            userId,
            videoId,
            reason: body ? "index_body_length_mismatch" : "index_body_read_failed",
            expectedLength: contentLength,
            receivedLength: body?.byteLength,
          });
          discardAudioSource(userId, videoId, source.url);
        }
        return null;
      }
      return { bytes: new Uint8Array(body), source, total: contentRange.total };
    } finally {
      operation.dispose();
    }
  }

  /** Probe one byte to obtain full-resource metadata without buffering media. */
  async function getAudioHeadResponse(
    userId: number,
    videoId: string,
    range: string | null,
    signal?: AbortSignal,
  ): Promise<Response | null> {
    const requested = parseAudioRange(range);
    if (!requested) return rangeNotSatisfiable();
    const operation = requestAbortSignal(signal);
    try {
      const probe: AudioByteRange = { start: 0, end: 0, requested: true };
      const result = await validatedAudioUpstream(userId, videoId, probe, operation.signal);
      if (!result) return null;
      if (result.kind === "response") return result.value;
      const { source, response, contentRange } = result.value;
      await response.body?.cancel().catch(() => {});
      if (range != null && requested.start >= contentRange.total) {
        return rangeNotSatisfiable(contentRange.total);
      }
      return new Response(null, {
        status: 200,
        headers: {
          "Content-Type": source.mime,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
          "Content-Length": String(contentRange.total),
        },
      });
    } finally {
      operation.dispose();
    }
  }

  const audioVod = createDownloadAudioVodStreaming({
    audioDiagnostic,
    readPrefix: readAudioPrefix,
    // The playlist resolves its source before reading anything, so the quiet
    // spell has to be honoured here too — otherwise a refused video still pays
    // yt-dlp in full before being told no.
    resolveAudioSource: async (userId, videoId, signal) =>
      refusalQuiet(userId, videoId) ? null : resolveAudioSource(userId, videoId, signal),
  });

  function invalidateAudioSources(userId: number): void {
    const prefix = `${userId}:`;
    for (const key of refusals.keys()) if (key.startsWith(prefix)) refusals.delete(key);
    audioVod.invalidateAudioVodSources(userId);
    invalidateResolvedAudioSources(userId);
  }

  async function retryAudioSource(userId: number, videoId: string, signal?: AbortSignal): Promise<boolean> {
    // Someone asked for this by hand: whatever we decided to stop asking about
    // is exactly what they want tried again.
    refusals.delete(audioSourceKey(userId, videoId));
    audioVod.invalidateAudioVodSource(userId, videoId);
    return retryResolvedAudioSource(userId, videoId, signal);
  }

  return {
    getAudioHeadResponse, getAudioResponse, ...audioVod,
    invalidateAudioSources, primeAudioSource, retryAudioSource,
  };
}
