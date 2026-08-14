import { AudioSourceCache, audioSourceKey } from "./audioSourceCache";
import { defaultAudioDiagnostic, type AudioDiagnostic } from "./audioDiagnostics";
import { callerWasRefused, cookieAttemptMemory } from "./cookieAttemptOrder";
import { downloadCookieAttempts } from "./downloadStrategy";
import { safeGoogleVideoUrl } from "./audioUpstreamUrl";
import { ytdlpAttemptArgs } from "./downloadConfig";
import { parseYtdlpHttpHeaders, type YtdlpHttpHeaders } from "./ytdlpHttpHeaders";
import { POT_PROVIDER_ARGS } from "./ytdlpPotProvider";

export interface AudioSource {
  url: string;
  mime: string;
  expiresAt: number;
  issuedAt?: number;
  httpHeaders: YtdlpHttpHeaders;
}

interface AudioResolution {
  controller: AbortController;
  promise: Promise<AudioSource | null>;
  waiters: number;
  settled: boolean;
}

interface AudioSourceResolverDependencies {
  YTDLP: string;
  downloadCookiesConfigured: (userId: number) => boolean;
  downloadCookiesFile: (userId: number) => string;
  ytdlpStatus: () => Promise<string | null>;
  audioDiagnostic?: AudioDiagnostic;
  spawn?: typeof Bun.spawn;
}

const AUDIO_RESOLVE_TIMEOUT_MS = 30_000;

export function createAudioSourceResolver(dependencies: AudioSourceResolverDependencies) {
  const {
    YTDLP,
    downloadCookiesConfigured,
    downloadCookiesFile,
    ytdlpStatus,
    audioDiagnostic = defaultAudioDiagnostic,
    spawn = Bun.spawn,
  } = dependencies;
  const audioSources = new AudioSourceCache<AudioSource>();
  const audioResolutions = new Map<string, AudioResolution>();

  function audioUrlExpiry(url: string): number {
    const match = url.match(/[?&]expire=(\d+)/);
    const expiresAt = match ? Number(match[1]) * 1000 : 0;
    return expiresAt ? Math.max(Date.now(), expiresAt - 300_000) : Date.now() + 3 * 3_600_000;
  }

  async function runResolverAttempt(
    userId: number,
    videoId: string,
    useCookies: boolean,
    signal: AbortSignal,
    /** Filled in when YouTube turned the caller away rather than the request. */
    refusedRef: { refused: boolean } = { refused: false },
  ): Promise<AudioSource | null> {
    const reportFailure = (reason: string, extra: Record<string, number | string> = {}) => {
      audioDiagnostic("warn", "audio.source_attempt_failed", {
        userId, videoId, reason, usedCookies: useCookies, ...extra,
      });
    };
    const args = [
      `https://www.youtube.com/watch?v=${videoId}`,
      "--ignore-config", "--no-playlist", "--no-warnings",
      "-f", "bestaudio[acodec^=mp4a]/bestaudio[ext=m4a]/140",
      "--print", "urls",
      "--print", "%(ext)s",
      "--print", "%(http_headers)j",
      ...POT_PROVIDER_ARGS,
    ];
    if (signal.aborted) return { source: null, anonymousRefused: false };

    let process: ReturnType<typeof Bun.spawn>;
    try {
      process = spawn([YTDLP, ...ytdlpAttemptArgs(args, useCookies, useCookies ? downloadCookiesFile(userId) : null)], { stdout: "pipe", stderr: "pipe" });
    } catch {
      reportFailure("spawn_failed");
      return { source: null, anonymousRefused: false };
    }

    let timedOut = false;
    const stop = () => { try { process.kill(); } catch {} };
    const onAbort = () => stop();
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; stop(); }, AUDIO_RESOLVE_TIMEOUT_MS);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(process.stdout as ReadableStream<Uint8Array>).text(),
        new Response(process.stderr as ReadableStream<Uint8Array>).text(),
        process.exited,
      ]);
      if (signal.aborted) return { source: null, anonymousRefused: false };
      if (timedOut) {
        reportFailure("timeout");
        return { source: null, anonymousRefused: false };
      }
      if (exitCode !== 0) {
        // The last line yt-dlp printed is the one that names the problem, and
        // reading it is the difference between "it failed" and knowing why.
        const said = stderr.trim().split(/\r?\n/).filter(Boolean).at(-1)?.slice(0, 300);
        refusedRef.refused = callerWasRefused(stderr);
        reportFailure("ytdlp_exit", said ? { exitCode, said } : { exitCode });
        return null;
      }
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      const url = safeGoogleVideoUrl(lines[0] ?? "");
      const extension = lines[1] ?? "m4a";
      const httpHeaders = parseYtdlpHttpHeaders(lines[2] ?? "");
      if (!url || !httpHeaders) {
        reportFailure("missing_or_rejected_url");
        return { source: null, anonymousRefused: false };
      }
      if (extension !== "m4a" && extension !== "mp4") {
        reportFailure("unsupported_extension");
        return { source: null, anonymousRefused: false };
      }
      return { source: { url, mime: "audio/mp4", expiresAt: audioUrlExpiry(url), issuedAt: Date.now(), httpHeaders }, anonymousRefused: false };
    } catch {
      if (!signal.aborted) reportFailure("process_io_failed");
      return { source: null, anonymousRefused: false };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }

  async function resolveFresh(userId: number, videoId: string, signal: AbortSignal): Promise<AudioSource | null> {
    const startedAt = Date.now();
    if (!(await ytdlpStatus()) || signal.aborted) {
      if (!signal.aborted) audioDiagnostic("warn", "audio.source_resolution_failed", {
        userId, videoId, reason: "ytdlp_unavailable", ms: Date.now() - startedAt,
      });
      return null;
    }
    let attempts = 0;
    const cookiesConfigured = downloadCookiesConfigured(userId);
    const order = cookiesConfigured
      ? cookieAttemptMemory.order(userId, true)
      : downloadCookieAttempts(false);
    for (const useCookies of order) {
      attempts++;
      const refusal = { refused: false };
      const source = await runResolverAttempt(userId, videoId, useCookies, signal, refusal);
      if (signal.aborted) return null;
      cookieAttemptMemory.record({
        userId, useCookies, resolved: Boolean(source), refused: refusal.refused,
      });
      if (source) {
        recordDownloadAttempt(userId, useCookies, true, anonymousRefused);
        audioDiagnostic("info", "audio.source_resolved", {
          userId, videoId, attempts, usedCookies: useCookies, mime: source.mime, ms: Date.now() - startedAt,
        });
        return source;
      }
    }
    audioDiagnostic("warn", "audio.source_resolution_failed", {
      userId, videoId, reason: "no_compatible_source", attempts, ms: Date.now() - startedAt,
    });
    return null;
  }

  function release(key: string, resolution: AudioResolution): void {
    resolution.waiters = Math.max(0, resolution.waiters - 1);
    if (resolution.waiters === 0 && !resolution.settled && audioResolutions.get(key) === resolution) {
      audioResolutions.delete(key);
      resolution.controller.abort();
    }
  }

  function waitFor(key: string, resolution: AudioResolution, signal?: AbortSignal): Promise<AudioSource | null> {
    if (signal?.aborted) return Promise.resolve(null);
    resolution.waiters++;
    return new Promise((resolve) => {
      let finished = false;
      const finish = (source: AudioSource | null) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener("abort", onAbort);
        release(key, resolution);
        resolve(source);
      };
      const onAbort = () => finish(null);
      signal?.addEventListener("abort", onAbort, { once: true });
      resolution.promise.then(finish, () => finish(null));
    });
  }

  async function resolveAudioSource(userId: number, videoId: string, signal?: AbortSignal): Promise<AudioSource | null> {
    if (signal?.aborted) return null;
    const cached = audioSources.get(userId, videoId);
    if (cached) return cached;
    const key = audioSourceKey(userId, videoId);
    let resolution = audioResolutions.get(key);
    if (!resolution) {
      const controller = new AbortController();
      resolution = { controller, promise: Promise.resolve(null), waiters: 0, settled: false };
      const current = resolution;
      current.promise = resolveFresh(userId, videoId, controller.signal)
        .then((source) => {
          if (source && !controller.signal.aborted) audioSources.set(userId, videoId, source);
          return controller.signal.aborted ? null : source;
        })
        .catch(() => null)
        .finally(() => {
          current.settled = true;
          if (audioResolutions.get(key) === current) audioResolutions.delete(key);
        });
      audioResolutions.set(key, current);
    }
    return waitFor(key, resolution, signal);
  }

  async function refreshAudioSource(
    userId: number,
    videoId: string,
    staleUrl: string,
    signal?: AbortSignal,
  ): Promise<AudioSource | null> {
    const current = audioSources.get(userId, videoId);
    if (current?.url !== staleUrl) return current ?? resolveAudioSource(userId, videoId, signal);
    audioSources.delete(userId, videoId);
    return resolveAudioSource(userId, videoId, signal);
  }

  function discardAudioSource(userId: number, videoId: string, failedUrl: string): void {
    const current = audioSources.get(userId, videoId);
    if (current?.url === failedUrl) audioSources.delete(userId, videoId);
  }

  function invalidateAudioSource(userId: number, videoId: string): void {
    audioSources.delete(userId, videoId);
    const key = audioSourceKey(userId, videoId);
    const resolution = audioResolutions.get(key);
    if (!resolution) return;
    audioResolutions.delete(key);
    resolution.controller.abort();
  }

  async function retryAudioSource(userId: number, videoId: string, signal?: AbortSignal): Promise<boolean> {
    invalidateAudioSource(userId, videoId);
    return Boolean(await resolveAudioSource(userId, videoId, signal));
  }

  function invalidateAudioSources(userId: number): void {
    audioSources.invalidateUser(userId);
    const prefix = `${userId}:`;
    for (const [key, resolution] of audioResolutions) {
      if (!key.startsWith(prefix)) continue;
      audioResolutions.delete(key);
      resolution.controller.abort();
    }
  }

  return { discardAudioSource, invalidateAudioSources, refreshAudioSource, resolveAudioSource, retryAudioSource };
}
