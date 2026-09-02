import { describe, expect, test } from "bun:test";
import { createDownloadStreaming } from "./downloadStreaming";
import type { DlSettings } from "./downloader";

const futureExpiry = 9_999_999_999;

function fakeProcess(stdout: string, exitCode = 0): ReturnType<typeof Bun.spawn> {
  return {
    stdout: new Response(stdout).body!,
    stderr: new Response("").body!,
    exited: Promise.resolve(exitCode),
    kill: () => {},
  } as unknown as ReturnType<typeof Bun.spawn>;
}

function successfulSpawn(url: string): typeof Bun.spawn {
  return (() => fakeProcess(`${url}\nm4a\n{"User-Agent":"yt-dlp-agent"}\n`)) as unknown as typeof Bun.spawn;
}

function rangeResponse(
  bytes: number[],
  start = 0,
  total = start + bytes.length,
): Response {
  const end = start + bytes.length - 1;
  return new Response(new Uint8Array(bytes), {
    status: 206,
    headers: {
      "Content-Length": String(bytes.length),
      "Content-Range": `bytes ${start}-${end}/${total}`,
    },
  });
}

function factory(overrides: Partial<Parameters<typeof createDownloadStreaming>[0]> = {}) {
  return createDownloadStreaming({
    DOWNLOADS_DIR: "/tmp/ytzero-audio-test-unused",
    YTDLP: "yt-dlp",
    dlEnabled: async () => false,
    dlSettings: async () => ({}) as DlSettings,
    downloadCookiesConfigured: () => false,
    downloadCookiesFile: (userId) => `/cookies/${userId}.txt`,
    prioritizeDownload: async () => false,
    readLines: async () => {},
    ytdlpStatus: async () => "test",
    audioDiagnostic: () => {},
    // Refusals are waited out in production; a test should not sit through it.
    wait: async () => {},
    ...overrides,
  });
}

describe("audio streaming integration", () => {

  test("answers a track's first bytes from what building its playlist read", async () => {
    // The handover between two entries of a list should not wait on YouTube
    // for bytes the server held a moment earlier while reading the index.
    const file = new Uint8Array(400_000).map((_, index) => index % 251);
    let upstreamReads = 0;
    const audio = factory({
      spawn: successfulSpawn(`https://r1.googlevideo.com/audio?expire=${futureExpiry}`),
      fetchImpl: (async (_input: unknown, init?: RequestInit) => {
        upstreamReads++;
        const header = new Headers(init?.headers).get("range") ?? "";
        const [start, end] = header.replace("bytes=", "").split("-").map(Number);
        const last = Math.min(end, file.byteLength - 1);
        const slice = file.slice(start, last + 1);
        return new Response(slice, {
          status: 206,
          headers: {
            "Content-Length": String(slice.byteLength),
            "Content-Range": `bytes ${start}-${last}/${file.byteLength}`,
          },
        });
      }) as unknown as typeof fetch,
    });

    // Whatever the playlist build reads, the head of the file comes with it.
    await audio.getAudioVodPlaylist(1, "video");
    const afterIndex = upstreamReads;
    expect(afterIndex).toBeGreaterThan(0);

    const first = await audio.getAudioResponse(1, "video", "bytes=0-999");
    expect(first?.status).toBe(206);
    expect(first?.headers.get("content-range")).toBe(`bytes 0-999/${file.byteLength}`);
    expect([...new Uint8Array(await first!.arrayBuffer())]).toEqual([...file.slice(0, 1000)]);
    expect(upstreamReads).toBe(afterIndex);

    // Past what was kept, it goes upstream as before.
    const later = await audio.getAudioResponse(1, "video", "bytes=300000-300099");
    expect(later?.status).toBe(206);
    expect(upstreamReads).toBeGreaterThan(afterIndex);
  });

  test("stops asking yt-dlp about a source the upstream keeps refusing", async () => {
    // A cookie-authenticated extraction can hand back a URL bound to a token
    // the proxy cannot present, and YouTube answers 403 to everyone else.
    // One refusal is worth another go — the same video often plays a moment
    // later — but a player retrying every couple of seconds must not become a
    // stream of requests aimed at a host that has already said no.
    let resolves = 0;
    let clock = 1_000;
    const audio = factory({
      now: () => clock,
      spawn: (() => {
        resolves++;
        return fakeProcess(`https://r1.googlevideo.com/audio?expire=${futureExpiry}\nm4a\n{"User-Agent":"yt-dlp-agent"}\n`);
      }) as unknown as typeof Bun.spawn,
      fetchImpl: (async () => new Response(null, { status: 403 })) as unknown as typeof fetch,
    });

    expect(await audio.getAudioResponse(1, "video", null)).toBeNull();
    const afterFirst = resolves;
    expect(afterFirst).toBeGreaterThan(0);

    // A second attempt is still made: the first refusal alone proves nothing.
    expect(await audio.getAudioResponse(1, "video", null)).toBeNull();
    expect(resolves).toBeGreaterThan(afterFirst);

    // Two in a row do, and the requests that follow cost nothing.
    const afterSecond = resolves;
    expect(await audio.getAudioResponse(1, "video", null)).toBeNull();
    expect(await audio.getAudioResponse(1, "video", "bytes=0-1")).toBeNull();
    expect(resolves).toBe(afterSecond);

    // The pause is short: a source that comes back is picked up without
    // anyone having to ask for it.
    clock += 10_000;
    expect(await audio.getAudioResponse(1, "video", null)).toBeNull();
    expect(resolves).toBeGreaterThan(afterSecond);
  });
  test("normalizes a range-less GET to one bounded verified 206 chunk", async () => {
    const ranges: string[] = [];
    const agents: string[] = [];
    const audio = factory({
      spawn: (() => fakeProcess(`https://r1.googlevideo.com/audio?expire=${futureExpiry}\nm4a\n{"User-Agent":"signed-audio-client","Accept-Language":"pl-PL"}\n`)) as unknown as typeof Bun.spawn,
      fetchImpl: (async (_input, init) => {
        const headers = new Headers(init?.headers);
        ranges.push(headers.get("range") ?? "");
        agents.push(headers.get("user-agent") ?? "");
        // Only who is asking is carried: the rest of what yt-dlp printed
        // describes its fetch of the watch page, and on a byte range those
        // headers are what googlevideo answers 403 to.
        expect(headers.get("accept-language")).toBeNull();
        return rangeResponse([1, 2, 3, 4], 0, 4);
      }) as typeof fetch,
    });

    const response = await audio.getAudioResponse(1, "video", null);
    expect(response?.status).toBe(206);
    expect(ranges).toEqual(["bytes=0-8388607"]);
    expect(agents).toEqual(["signed-audio-client"]);
    expect(response?.headers.get("content-type")).toBe("audio/mp4");
    expect(response?.headers.get("accept-ranges")).toBe("bytes");
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("content-length")).toBe("4");
    expect(response?.headers.get("content-range")).toBe("bytes 0-3/4");
    expect([...new Uint8Array(await response!.arrayBuffer())]).toEqual([1, 2, 3, 4]);
  });

  test("rejects a malformed Range before resolving or fetching", async () => {
    let spawns = 0;
    let fetches = 0;
    const audio = factory({
      spawn: (() => { spawns++; return fakeProcess(""); }) as unknown as typeof Bun.spawn,
      fetchImpl: (async () => { fetches++; return rangeResponse([1]); }) as unknown as typeof fetch,
    });

    const response = await audio.getAudioResponse(1, "video", "bytes=-500");
    expect(response?.status).toBe(416);
    expect(spawns).toBe(0);
    expect(fetches).toBe(0);
  });

  test("propagates a valid upstream 416 representation length", async () => {
    const audio = factory({
      spawn: successfulSpawn(`https://r1.googlevideo.com/audio?expire=${futureExpiry}`),
      fetchImpl: (async () => new Response(null, {
        status: 416,
        headers: { "Content-Range": "bytes */1234" },
      })) as unknown as typeof fetch,
    });

    const response = await audio.getAudioResponse(1, "video", "bytes=5000-");
    expect(response?.status).toBe(416);
    expect(response?.headers.get("content-range")).toBe("bytes */1234");
  });

  test("rejects an ignored range and mismatched upstream framing", async () => {
    const audio = factory({
      spawn: ((command: string[]) => {
        const videoId = new URL(command.find((arg) => arg.startsWith("https://www.youtube.com/"))!).searchParams.get("v");
        return fakeProcess(`https://r1.googlevideo.com/${videoId}?expire=${futureExpiry}\nm4a\n{"User-Agent":"yt-dlp-agent"}\n`);
      }) as unknown as typeof Bun.spawn,
      fetchImpl: (async (input) => {
        if (String(input).includes("ignored")) {
          return new Response(new Uint8Array([1]), { status: 200, headers: { "Content-Length": "1" } });
        }
        return new Response(new Uint8Array([1, 2]), {
          status: 206,
          headers: { "Content-Length": "2", "Content-Range": "bytes 1-2/10" },
        });
      }) as typeof fetch,
    });

    expect(await audio.getAudioResponse(1, "ignored", "bytes=0-0")).toBeNull();
    expect(await audio.getAudioResponse(1, "mismatch", "bytes=0-1")).toBeNull();
  });

  test("isolates profile cookie resolutions, shares in-flight work, and invalidates one profile", async () => {
    let spawns = 0;
    const audio = factory({
      downloadCookiesConfigured: () => true,
      spawn: ((command: string[]) => {
        spawns++;
        const cookieIndex = command.indexOf("--cookies");
        if (cookieIndex < 0) return fakeProcess("", 1);
        const userId = command[cookieIndex + 1].match(/(\d+)\.txt$/)?.[1];
        return fakeProcess(`https://r1.googlevideo.com/profile-${userId}?expire=${futureExpiry}\nm4a\n{"User-Agent":"profile-${userId}-agent"}\n`);
      }) as unknown as typeof Bun.spawn,
      fetchImpl: (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const profile = String(input).match(/profile-(\d+)/)?.[1];
        expect(new Headers(init?.headers).get("user-agent")).toBe(`profile-${profile}-agent`);
        return rangeResponse([1], 0, 1);
      }) as unknown as typeof fetch,
    });

    const [first, second] = await Promise.all([
      audio.getAudioResponse(1, "video", "bytes=0-0"),
      audio.getAudioResponse(1, "video", "bytes=0-0"),
    ]);
    expect(first?.status).toBe(206);
    expect(second?.status).toBe(206);
    expect(spawns).toBe(2); // one anonymous attempt + one shared cookie attempt

    await audio.getAudioResponse(2, "video", "bytes=0-0");
    expect(spawns).toBe(4);
    await audio.getAudioResponse(2, "video", "bytes=0-0");
    expect(spawns).toBe(4);

    audio.invalidateAudioSources(1);
    await audio.getAudioResponse(2, "video", "bytes=0-0");
    expect(spawns).toBe(4);
    await audio.getAudioResponse(1, "video", "bytes=0-0");
    expect(spawns).toBe(6);
  });

  test("re-resolves once after a cached direct URL returns 403", async () => {
    let spawns = 0;
    let fetches = 0;
    const audio = factory({
      spawn: (() => {
        spawns++;
        return fakeProcess(`https://r1.googlevideo.com/version-${spawns}?expire=${futureExpiry}\nm4a\n{"User-Agent":"yt-dlp-agent"}\n`);
      }) as unknown as typeof Bun.spawn,
      fetchImpl: (async (input) => {
        fetches++;
        return String(input).includes("version-1")
          ? new Response(null, { status: 403 })
          : rangeResponse([7], 0, 1);
      }) as typeof fetch,
    });

    const response = await audio.getAudioResponse(1, "video", "bytes=0-0");
    expect(response?.status).toBe(206);
    // The first URL is asked for again, several times, before anything is
    // re-resolved: waiting out a refusal is cheaper than six seconds of yt-dlp.
    expect(spawns).toBe(2);
    expect(fetches).toBe(6);
  });

  test("follows a bounded, revalidated googlevideo redirect and preserves Range", async () => {
    const requests: Array<{ url: string; range: string }> = [];
    const audio = factory({
      spawn: successfulSpawn(`https://r1.googlevideo.com/audio?expire=${futureExpiry}`),
      fetchImpl: (async (input, init) => {
        requests.push({
          url: String(input),
          range: new Headers(init?.headers).get("range") ?? "",
        });
        if (requests.length === 1) {
          return new Response(null, {
            status: 302,
            headers: { Location: `https://r2.googlevideo.com/audio?expire=${futureExpiry}` },
          });
        }
        return rangeResponse([4, 2], 0, 2);
      }) as typeof fetch,
    });

    expect((await audio.getAudioResponse(1, "video", "bytes=0-1"))?.status).toBe(206);
    expect(requests).toEqual([
      { url: `https://r1.googlevideo.com/audio?expire=${futureExpiry}`, range: "bytes=0-1" },
      { url: `https://r2.googlevideo.com/audio?expire=${futureExpiry}`, range: "bytes=0-1" },
    ]);
  });

  test("rejects an audio redirect outside googlevideo without requesting it", async () => {
    const requests: string[] = [];
    const audio = factory({
      spawn: successfulSpawn(`https://r1.googlevideo.com/audio?expire=${futureExpiry}`),
      fetchImpl: (async (input) => {
        requests.push(String(input));
        return new Response(null, {
          status: 302,
          headers: { Location: "https://example.com/not-a-media-host" },
        });
      }) as typeof fetch,
    });

    expect(await audio.getAudioResponse(1, "video", "bytes=0-0")).toBeNull();
    expect(requests).toEqual([`https://r1.googlevideo.com/audio?expire=${futureExpiry}`]);
  });

  test("does not reuse a cached source after an upstream failure", async () => {
    let spawns = 0;
    const audio = factory({
      spawn: (() => fakeProcess(
        `https://r1.googlevideo.com/version-${++spawns}?expire=${futureExpiry}\nm4a\n{"User-Agent":"yt-dlp-agent"}\n`,
      )) as unknown as typeof Bun.spawn,
      fetchImpl: (async (input) => String(input).includes("version-1")
        ? new Response(null, { status: 500 })
        : rangeResponse([8], 0, 1)) as typeof fetch,
    });

    expect(await audio.getAudioResponse(1, "video", "bytes=0-0")).toBeNull();
    expect((await audio.getAudioResponse(1, "video", "bytes=0-0"))?.status).toBe(206);
    expect(spawns).toBe(2);
  });

  test("diagnostics describe redirect failures without exposing signed URLs", async () => {
    const diagnostics: Array<{ event: string; meta: Record<string, unknown> }> = [];
    const secret = "signed-query-must-not-be-logged";
    const audio = factory({
      audioDiagnostic: (_level, event, meta) => diagnostics.push({ event, meta }),
      spawn: successfulSpawn(`https://r1.googlevideo.com/audio?token=${secret}&expire=${futureExpiry}`),
      fetchImpl: (async () => new Response(null, {
        status: 302,
        headers: { Location: `https://example.com/audio?token=${secret}` },
      })) as unknown as typeof fetch,
    });

    expect(await audio.getAudioResponse(1, "video", "bytes=0-0")).toBeNull();
    expect(diagnostics.some(({ event }) => event === "audio.upstream_failed")).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toContain(secret);
  });

  test("a late stale 403 reuses the source refreshed by a concurrent request", async () => {
    let spawns = 0;
    let staleFetches = 0;
    let releaseFirstStale: () => void = () => {};
    let releaseLateStale: () => void = () => {};
    const firstStale = new Promise<void>((resolve) => { releaseFirstStale = resolve; });
    const lateStale = new Promise<void>((resolve) => { releaseLateStale = resolve; });
    const audio = factory({
      spawn: (() => {
        spawns++;
        return fakeProcess(`https://r1.googlevideo.com/version-${spawns}?expire=${futureExpiry}\nm4a\n{"User-Agent":"yt-dlp-agent"}\n`);
      }) as unknown as typeof Bun.spawn,
      fetchImpl: (async (input) => {
        const url = String(input);
        if (url.includes("version-1")) {
          staleFetches++;
          // The first two are the two requests racing; the rest are the same
          // request asking again, which needs no holding.
          if (staleFetches === 1) await firstStale;
          else if (staleFetches === 2) await lateStale;
          return new Response(null, { status: 403 });
        }
        return rangeResponse([7], 0, 1);
      }) as typeof fetch,
    });

    // Both requests fetch the same cached generation. Let one refresh it, then
    // deliver the other's stale 403 only after the replacement is cached.
    const first = audio.getAudioResponse(1, "video", "bytes=0-0");
    while (staleFetches < 1) await Promise.resolve();
    const second = audio.getAudioResponse(1, "video", "bytes=0-0");
    while (staleFetches < 2) await Promise.resolve();
    releaseFirstStale();
    releaseLateStale();
    expect((await first)?.status).toBe(206);
    expect((await second)?.status).toBe(206);
    expect(spawns).toBe(2);
  });

  test("starts a fresh resolve immediately after the last waiter aborts", async () => {
    let spawns = 0;
    let closeFirstStdout: (() => void) | null = null;
    let finishFirst: ((code: number) => void) | null = null;
    const audio = factory({
      spawn: (() => {
        spawns++;
        if (spawns > 1) {
          return fakeProcess(`https://r1.googlevideo.com/retry?expire=${futureExpiry}\nm4a\n{"User-Agent":"yt-dlp-agent"}\n`);
        }
        const stdout = new ReadableStream<Uint8Array>({
          start(controller) { closeFirstStdout = () => controller.close(); },
        });
        const exited = new Promise<number>((resolve) => { finishFirst = resolve; });
        return {
          stdout,
          stderr: new Response("").body!,
          exited,
          kill: () => {
            closeFirstStdout?.();
            finishFirst?.(1);
          },
        } as unknown as ReturnType<typeof Bun.spawn>;
      }) as unknown as typeof Bun.spawn,
      fetchImpl: (async () => rangeResponse([9], 0, 1)) as unknown as typeof fetch,
    });

    const controller = new AbortController();
    const aborted = audio.getAudioResponse(1, "video", "bytes=0-0", controller.signal);
    while (spawns === 0) await Promise.resolve();
    controller.abort();
    const retried = audio.getAudioResponse(1, "video", "bytes=0-0");

    expect(await aborted).toBeNull();
    expect((await retried)?.status).toBe(206);
    expect(spawns).toBe(2);
  });

  test("HEAD probes only one byte and describes the full representation", async () => {
    const ranges: string[] = [];
    const audio = factory({
      spawn: successfulSpawn(`https://r1.googlevideo.com/audio?expire=${futureExpiry}`),
      fetchImpl: (async (_input, init) => {
        ranges.push(new Headers(init?.headers).get("range") ?? "");
        return rangeResponse([1], 0, 999);
      }) as typeof fetch,
    });

    const response = await audio.getAudioHeadResponse(1, "video", null);
    expect(response?.status).toBe(200);
    expect(ranges).toEqual(["bytes=0-0"]);
    expect(response?.headers.get("content-length")).toBe("999");
    expect((await response!.arrayBuffer()).byteLength).toBe(0);
  });

  test("an explicit retry discards the cached URL and runs yt-dlp again", async () => {
    let spawns = 0;
    const audio = factory({
      spawn: (() => fakeProcess(`https://r1.googlevideo.com/version-${++spawns}?expire=${futureExpiry}\nm4a\n{"User-Agent":"yt-dlp-agent"}\n`)) as unknown as typeof Bun.spawn,
      fetchImpl: (async () => rangeResponse([1], 0, 1)) as unknown as typeof fetch,
    });

    expect((await audio.getAudioResponse(1, "video", "bytes=0-0"))?.status).toBe(206);
    expect(spawns).toBe(1);
    expect(await audio.retryAudioSource(1, "video", false)).toBe(true);
    expect(spawns).toBe(2);
    expect((await audio.getAudioResponse(1, "video", "bytes=0-0"))?.status).toBe(206);
    expect(spawns).toBe(2);
  });
});
