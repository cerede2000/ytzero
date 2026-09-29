import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createDownloadVideoDirectStreaming } from "./downloadVideoDirectStreaming";
import { subscribeToLogs } from "./logger";
import { createDownloadVideoStreaming } from "./downloadVideoStreaming";

function concat(...parts: Uint8Array<ArrayBufferLike>[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function uint16(value: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value);
  return bytes;
}

function uint32(value: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function typeBytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([...value].map((character) => character.charCodeAt(0)));
}

function box(type: string, payload: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBuffer> {
  return concat(uint32(8 + payload.byteLength), typeBytes(type), payload);
}

interface MediaFixture {
  bytes: Uint8Array<ArrayBuffer>;
  mediaOffset: number;
  references: Array<{ offset: number; length: number }>;
}

function mediaFixture(
  durations: number[],
  lengths: number[],
  options: { compatible?: boolean; largeInitialization?: boolean } = {},
): MediaFixture {
  const ftyp = box("ftyp", concat(
    typeBytes("dash"),
    uint32(0),
    typeBytes(options.compatible === false ? "isom" : "iso6"),
  ));
  const moov = box("moov", new Uint8Array(options.largeInitialization === false ? 16 : 256 * 1024));
  const entries = durations.map((duration, index) => concat(
    uint32(lengths[index]),
    uint32(duration),
    uint32(0x90000000),
  ));
  const sidx = box("sidx", concat(
    Uint8Array.of(0, 0, 0, 0),
    uint32(1),
    uint32(1_000),
    uint32(0),
    uint32(0),
    uint16(0),
    uint16(entries.length),
    ...entries,
  ));
  const mediaOffset = ftyp.byteLength + moov.byteLength + sidx.byteLength;
  let offset = mediaOffset;
  const references = lengths.map((length) => {
    const reference = { offset, length };
    offset += length;
    return reference;
  });
  const media = Uint8Array.from({ length: lengths.reduce((sum, length) => sum + length, 0) }, (_, index) => (
    (index * 17 + 29) % 251
  ));
  return { bytes: concat(ftyp, moov, sidx, media), mediaOffset, references };
}

function fakeProcess(stdout: string, exitCode = 0, stderr = "temporary extraction failure"): ReturnType<typeof Bun.spawn> {
  return {
    stdout: new Response(stdout).body!,
    stderr: new Response(exitCode === 0 ? "" : stderr).body!,
    exited: Promise.resolve(exitCode),
    kill: () => {},
  } as unknown as ReturnType<typeof Bun.spawn>;
}

function selection(version: number): string {
  const expires = 9_999_999_999;
  return JSON.stringify({
    duration: 12,
    http_headers: { "User-Agent": "yt-dlp-test-agent", "Accept-Language": "en-US" },
    requested_formats: [
      {
        format_id: "137",
        url: `https://r1.googlevideo.com/video-v${version}?expire=${expires}`,
        ext: "mp4",
        protocol: "https",
        vcodec: "avc1.640028",
        acodec: "none",
        width: 1920,
        height: 1080,
        fps: 30,
        vbr: 4_000,
      },
      {
        format_id: "140",
        url: `https://r1.googlevideo.com/audio-v${version}?expire=${expires}`,
        ext: "m4a",
        protocol: "https",
        vcodec: "none",
        acodec: "mp4a.40.2",
        abr: 128,
        audio_channels: 2,
      },
    ],
  });
}

function rangedResponse(bytes: Uint8Array, rangeValue: string | null): Response {
  const match = rangeValue?.match(/^bytes=(\d+)-(\d+)$/);
  if (!match) return new Response(null, { status: 400 });
  const start = Number(match[1]);
  const end = Math.min(Number(match[2]), bytes.byteLength - 1);
  if (start >= bytes.byteLength) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.byteLength}` } });
  }
  const body = bytes.slice(start, end + 1);
  return new Response(body, {
    status: 206,
    headers: {
      "Content-Length": String(body.byteLength),
      "Content-Range": `bytes ${start}-${end}/${bytes.byteLength}`,
    },
  });
}

function directDependencies(spawn: typeof Bun.spawn, fetchImpl: typeof fetch) {
  return {
    YTDLP: "yt-dlp",
    dlSettings: async () => ({ quality: "best" }),
    downloadCookiesConfigured: () => false,
    downloadCookiesFile: (userId: number) => `cookie-${userId}`,
    prioritizeDownload: async () => true,
    ytdlpStatus: async () => "2026.07.04",
    videoAvailable: async () => true,
    spawn,
    fetchImpl,
  };
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("direct no-transcode video HLS", () => {
  test("retries a temporary missing-format response before failing the native manifest", async () => {
    const media = mediaFixture([6_000, 6_000], [2_000, 2_000]);
    let attempts = 0;
    const spawn = (() => ++attempts === 1 ? fakeProcess("", 1, "ERROR: Requested format is not available") : fakeProcess(selection(1))) as unknown as typeof Bun.spawn;
    const fetchImpl = (async (_input, init) => rangedResponse(media.bytes, new Headers(init?.headers).get("range"))) as typeof fetch;
    const streaming = createDownloadVideoDirectStreaming(directDependencies(spawn, fetchImpl));
    expect((await streaming.getDirectHlsPlaylist(1, "short", "index.m3u8")).kind).toBe("playlist");
    expect(attempts).toBe(2);
    streaming.resetDirectHlsSessions();
  });

  test("bounds missing-format retries and never caches them as confirmed incompatibility", async () => {
    const media = mediaFixture([6_000, 6_000], [2_000, 2_000]);
    let attempts = 0;
    const spawn = (() => ++attempts <= 2 ? fakeProcess("", 1, "ERROR: Requested format is not available") : fakeProcess(selection(1))) as unknown as typeof Bun.spawn;
    const fetchImpl = (async (_input, init) => rangedResponse(media.bytes, new Headers(init?.headers).get("range"))) as typeof fetch;
    const streaming = createDownloadVideoDirectStreaming(directDependencies(spawn, fetchImpl));
    expect((await streaming.getDirectHlsPlaylist(1, "short", "index.m3u8")).kind).toBe("unsupported");
    expect(attempts).toBe(2);
    expect((await streaming.getDirectHlsPlaylist(1, "short", "index.m3u8")).kind).toBe("playlist");
    expect(attempts).toBe(3);
    streaming.resetDirectHlsSessions();
  });

  test("audio/video preloads across three Shorts wait for capacity instead of receiving 429", async () => {
    const media = mediaFixture([6_000, 6_000], [2_000, 2_000]);
    let hold = false;
    let active = 0;
    let maximum = 0;
    const pending: Array<() => void> = [];
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      if (hold) {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise<void>((resolve) => pending.push(resolve));
        active--;
      }
      return rangedResponse(media.bytes, new Headers(init?.headers).get("range"));
    }) as typeof fetch;
    const streaming = createDownloadVideoDirectStreaming(directDependencies((() => fakeProcess(selection(1))) as unknown as typeof Bun.spawn, fetchImpl));
    const ids = ["previous", "current", "next"];
    const versions = await Promise.all(ids.map(async (id) => {
      const master = await streaming.getDirectHlsPlaylist(1, id, "index.m3u8");
      if (master.kind !== "playlist") throw new Error("missing playlist");
      return master.playlist.match(/[?&]v=([a-f0-9]+)/)![1];
    }));
    hold = true;
    let completed = 0;
    const requests = ids.flatMap((id, index) => (["audio.mp4", "video.mp4"] as const).map((file) =>
      streaming.getDirectHlsResource(1, id, file, "bytes=0-15", undefined, versions[index]).then((result) => { completed++; return result; })));
    try {
      for (let i = 0; i < 100 && pending.length < 4; i++) await Bun.sleep(1);
      expect(pending).toHaveLength(4);
      expect(completed).toBe(0);
    } finally {
      hold = false;
      pending.splice(0).forEach((resolve) => resolve());
    }
    const results = await Promise.all(requests);
    expect(maximum).toBe(4);
    expect(results.map((result) => result.kind === "response" ? result.response.status : result.kind)).toEqual([206, 206, 206, 206, 206, 206]);
  });

  test("standalone playback preserves per-format headers and never starts a download", async () => {
    const video = mediaFixture([6_000, 6_000], [2_000, 2_000]);
    const audio = mediaFixture([6_000, 6_000], [500, 500]);
    const metadata = JSON.parse(selection(1));
    metadata.requested_formats[0].http_headers = { "User-Agent": "video-agent", Referer: "https://www.youtube.com/" };
    const commands: string[][] = [];
    const spawn = ((command: string[]) => {
      commands.push(command);
      return fakeProcess(JSON.stringify(metadata));
    }) as unknown as typeof Bun.spawn;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const isVideo = String(input).includes("/video-");
      const headers = new Headers(init?.headers);
      expect(headers.get("user-agent")).toBe(isVideo ? "video-agent" : "yt-dlp-test-agent");
      expect(headers.get(isVideo ? "referer" : "accept-language")).toBe(isVideo ? "https://www.youtube.com/" : "en-US");
      return rangedResponse(isVideo ? video.bytes : audio.bytes, headers.get("range"));
    }) as typeof fetch;
    const { prioritizeDownload: _unused, ...dependencies } = directDependencies(spawn, fetchImpl);
    const streaming = createDownloadVideoDirectStreaming({ ...dependencies, resourcePath: "direct-hls" });
    const result = await streaming.getDirectHlsPlaylist(1, "standalone", "index.m3u8");
    expect(result.kind).toBe("playlist");
    if (result.kind !== "playlist") throw new Error("missing playlist");
    expect(result.playlist).toContain("/direct-hls/");
    expect(result.playlist).not.toContain("googlevideo.com");
    const version = result.playlist.match(/\?v=([a-f0-9]+)/)![1];
    expect((await streaming.getDirectHlsResource(1, "standalone", "video.mp4", "bytes=0-15", undefined, version)).kind).toBe("response");
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain("--skip-download");
    streaming.invalidateDirectHlsSources(1);
    expect(streaming.hasDirectHlsSession(1, "standalone")).toBe(false);
    expect((await streaming.getDirectHlsPlaylist(1, "standalone", "index.m3u8")).kind).toBe("playlist");
    expect(commands).toHaveLength(2);
    streaming.resetDirectHlsSessions();
  });

  test("rejects missing or malformed yt-dlp headers before fetching media", async () => {
    for (const headers of [undefined, {}, { "User-Agent": 123 }, { "User-Agent": "bad\r\nheader" }]) {
      const metadata = JSON.parse(selection(1));
      metadata.http_headers = headers;
      let requests = 0;
      const spawn = (() => fakeProcess(JSON.stringify(metadata))) as unknown as typeof Bun.spawn;
      const fetchImpl = (async () => { requests++; return new Response(null, { status: 500 }); }) as unknown as typeof fetch;
      const streaming = createDownloadVideoDirectStreaming(directDependencies(spawn, fetchImpl));
      expect((await streaming.getDirectHlsPlaylist(1, "bad-headers", "index.m3u8")).kind).toBe("unsupported");
      expect(requests).toBe(0);
      streaming.resetDirectHlsSessions();
    }
  });

  test("a refused index says which stream, and why, instead of only a failed request", async () => {
    // Every failure below this line leaves the route with nothing but a 502.
    // Read from the instance's log, "the television cannot play this" and
    // "the host refused the URL it had just issued" must not look the same.
    const audio = mediaFixture([6_000], [500]);
    const spawn = (() => fakeProcess(selection(1))) as unknown as typeof Bun.spawn;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => (
      String(input).includes("/video-")
        ? new Response(null, { status: 403 })
        : rangedResponse(audio.bytes, new Headers(init?.headers).get("range"))
    )) as typeof fetch;
    const streaming = createDownloadVideoDirectStreaming(directDependencies(spawn, fetchImpl));
    const lines: string[] = [];
    const stop = subscribeToLogs((event) => lines.push(event.line));
    try {
      expect((await streaming.getDirectHlsPlaylist(1, "refused-index", "index.m3u8")).kind).toBe("failed");
    } finally {
      stop();
      streaming.resetDirectHlsSessions();
    }
    const reported = lines.filter((line) => line.includes("downloads.direct_stream_index_failed"));
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain('"stream":"video"');
    expect(reported[0]).toContain('"reason":"refused"');
    expect(reported[0]).toContain('"status":403');
    expect(reported[0]).toContain('"videoId":"refused-index"');
  });

  test("a refused index URL is resolved again on the next manifest request", async () => {
    const video = mediaFixture([6_000, 6_000], [2_000, 2_000]);
    const audio = mediaFixture([6_000, 6_000], [500, 500]);
    let resolutions = 0;
    const spawn = (() => fakeProcess(selection(++resolutions))) as unknown as typeof Bun.spawn;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes("-v1?")) return new Response(null, { status: 403 });
      return rangedResponse(String(input).includes("/video-") ? video.bytes : audio.bytes, new Headers(init?.headers).get("range"));
    }) as typeof fetch;
    const streaming = createDownloadVideoDirectStreaming(directDependencies(spawn, fetchImpl));
    expect((await streaming.getDirectHlsPlaylist(1, "retry", "index.m3u8")).kind).toBe("failed");
    expect((await streaming.getDirectHlsPlaylist(1, "retry", "index.m3u8")).kind).toBe("playlist");
    expect(resolutions).toBe(2);
    streaming.resetDirectHlsSessions();
  });

  test("splits a large fragment into upstream ranges below YouTube's throttle threshold", async () => {
    const video = mediaFixture([6_000, 6_000], [9 * 1024 * 1024, 2_000]);
    const audio = mediaFixture([6_000, 6_000], [500, 500]);
    const ranges: string[] = [];
    const spawn = (() => fakeProcess(selection(1))) as unknown as typeof Bun.spawn;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const range = new Headers(init?.headers).get("range")!;
      const [start, end] = range.slice(6).split("-").map(Number);
      expect(end - start + 1).toBeLessThanOrEqual(8 * 1024 * 1024);
      ranges.push(range);
      return rangedResponse(String(input).includes("/video-") ? video.bytes : audio.bytes, range);
    }) as typeof fetch;
    const streaming = createDownloadVideoDirectStreaming(directDependencies(spawn, fetchImpl));
    const master = await streaming.getDirectHlsPlaylist(1, "large", "index.m3u8");
    if (master.kind !== "playlist") throw new Error("missing playlist");
    const version = master.playlist.match(/\?v=([a-f0-9]+)/)![1];
    ranges.length = 0;
    const fragment = video.references[0];
    const result = await streaming.getDirectHlsResource(1, "large", "video.mp4", `bytes=${fragment.offset}-${fragment.offset + fragment.length - 1}`, undefined, version);
    expect(result.kind).toBe("response");
    if (result.kind !== "response") throw new Error("missing media");
    expect(ranges).toHaveLength(2);
    expect(result.response.headers.get("content-length")).toBe(String(fragment.length));
    expect(new Uint8Array(await result.response.arrayBuffer())).toEqual(video.bytes.slice(fragment.offset, fragment.offset + fragment.length));
    streaming.resetDirectHlsSessions();
  });

  test("builds separate fMP4 playlists and proxies the exact far byte range", async () => {
    const video = mediaFixture([6_000, 6_000], [8_193, 7_777]);
    const audio = mediaFixture([3_000, 3_000, 3_000, 3_000], [1_001, 1_003, 1_007, 1_009]);
    const requests: Array<{ url: string; range: string | null }> = [];
    const spawn = ((command: string[]) => {
      expect(command).toContain("--ignore-config");
      expect(command).toContain("--dump-single-json");
      return fakeProcess(selection(1));
    }) as unknown as typeof Bun.spawn;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const range = new Headers(init?.headers).get("range");
      requests.push({ url, range });
      return rangedResponse(url.includes("/video-") ? video.bytes : audio.bytes, range);
    }) as typeof fetch;
    const streaming = createDownloadVideoDirectStreaming(directDependencies(spawn, fetchImpl));

    const master = await streaming.getDirectHlsPlaylist(1, "direct-video", "index.m3u8");
    const masterText = master.kind === "playlist" ? master.playlist : "";
    const generation = masterText.match(/[?&]v=([a-f0-9]+)/)?.[1] ?? "";
    const videoPlaylist = await streaming.getDirectHlsPlaylist(
      1, "direct-video", "video.m3u8", undefined, generation,
    );
    const audioPlaylist = await streaming.getDirectHlsPlaylist(
      1, "direct-video", "audio.m3u8", undefined, generation,
    );

    expect(masterText).toContain('AUDIO="audio"');
    expect(generation).not.toBe("");
    expect(videoPlaylist.kind === "playlist" ? videoPlaylist.playlist : "").toContain("#EXT-X-BYTERANGE");
    expect(audioPlaylist.kind === "playlist" ? audioPlaylist.playlist : "").toContain("audio.mp4");
    const far = video.references[1];
    const exactRange = `bytes=${far.offset}-${far.offset + far.length - 1}`;
    expect((await streaming.getDirectHlsResource(
      1, "direct-video", "video.mp4", exactRange, undefined, "deadbeefdeadbeefdeadbeef",
    )).kind).toBe("stale");
    const resource = await streaming.getDirectHlsResource(
      1, "direct-video", "video.mp4", exactRange, undefined, generation,
    );

    expect(resource.kind).toBe("response");
    if (resource.kind !== "response") return;
    expect(resource.response.status).toBe(206);
    expect(resource.response.headers.get("content-range"))
      .toBe(`bytes ${far.offset}-${far.offset + far.length - 1}/${video.bytes.byteLength}`);
    expect(new Uint8Array(await resource.response.arrayBuffer()))
      .toEqual(video.bytes.slice(far.offset, far.offset + far.length));
    expect(requests.at(-1)).toEqual({
      url: "https://r1.googlevideo.com/video-v1?expire=9999999999",
      range: exactRange,
    });
    streaming.resetDirectHlsSessions();
  });

  test("isolates source resolution and sessions by profile", async () => {
    const video = mediaFixture([6_000, 6_000], [2_000, 2_000]);
    const audio = mediaFixture([6_000, 6_000], [500, 500]);
    let resolutions = 0;
    const spawn = (() => fakeProcess(selection(++resolutions))) as unknown as typeof Bun.spawn;
    const requestedUrls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requestedUrls.push(url);
      return rangedResponse(url.includes("/video-") ? video.bytes : audio.bytes, new Headers(init?.headers).get("range"));
    }) as typeof fetch;
    const streaming = createDownloadVideoDirectStreaming(directDependencies(spawn, fetchImpl));

    const firstMaster = await streaming.getDirectHlsPlaylist(11, "shared", "index.m3u8");
    const secondMaster = await streaming.getDirectHlsPlaylist(22, "shared", "index.m3u8");
    expect(firstMaster.kind).toBe("playlist");
    expect(secondMaster.kind).toBe("playlist");
    const firstGeneration = firstMaster.kind === "playlist"
      ? firstMaster.playlist.match(/[?&]v=([a-f0-9]+)/)?.[1] ?? ""
      : "";
    const secondGeneration = secondMaster.kind === "playlist"
      ? secondMaster.playlist.match(/[?&]v=([a-f0-9]+)/)?.[1] ?? ""
      : "";
    const range = `bytes=${video.references[0].offset}-${video.references[0].offset + 9}`;
    await streaming.getDirectHlsResource(11, "shared", "video.mp4", range, undefined, firstGeneration);
    await streaming.getDirectHlsResource(22, "shared", "video.mp4", range, undefined, secondGeneration);

    expect(resolutions).toBe(2);
    expect(requestedUrls).toContain("https://r1.googlevideo.com/video-v1?expire=9999999999");
    expect(requestedUrls).toContain("https://r1.googlevideo.com/video-v2?expire=9999999999");
    streaming.resetDirectHlsSessions();
  });

  test("rejects an off-allowlist redirect, refreshes URLs and retries the identical range", async () => {
    const video = mediaFixture([6_000, 6_000], [4_000, 4_000]);
    const audio = mediaFixture([6_000, 6_000], [1_000, 1_000]);
    let resolutions = 0;
    const spawn = (() => fakeProcess(selection(++resolutions))) as unknown as typeof Bun.spawn;
    const requests: Array<{ url: string; range: string | null }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const range = new Headers(init?.headers).get("range");
      requests.push({ url, range });
      if (url.includes("video-v1") && range && !range.startsWith("bytes=0-")) {
        return new Response(null, { status: 302, headers: { Location: "https://evil.example/private" } });
      }
      return rangedResponse(url.includes("/video-") ? video.bytes : audio.bytes, range);
    }) as typeof fetch;
    const streaming = createDownloadVideoDirectStreaming(directDependencies(spawn, fetchImpl));
    const master = await streaming.getDirectHlsPlaylist(1, "refresh", "index.m3u8");
    expect(master.kind).toBe("playlist");
    const generation = master.kind === "playlist"
      ? master.playlist.match(/[?&]v=([a-f0-9]+)/)?.[1] ?? ""
      : "";
    const first = video.references[0];
    const range = `bytes=${first.offset}-${first.offset + first.length - 1}`;

    const resource = await streaming.getDirectHlsResource(
      1, "refresh", "video.mp4", range, undefined, generation,
    );

    expect(resource.kind).toBe("response");
    expect(resolutions).toBe(2);
    expect(requests.map((request) => new URL(request.url).hostname)).not.toContain("evil.example");
    expect(requests.at(-1)).toEqual({
      url: "https://r1.googlevideo.com/video-v2?expire=9999999999",
      range,
    });
    streaming.resetDirectHlsSessions();
  });

  test("falls back for confirmed format/index incompatibility, not a transient resolver failure", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "ytzero-direct-hls-test-"));
    roots.push(root);
    const unsupportedVideo = mediaFixture([6_000, 6_000], [2_000, 2_000], { compatible: false });
    const unsupportedAudio = mediaFixture([6_000, 6_000], [500, 500], { compatible: false });
    let transcodeProbes = 0;
    let directFailure: "transient" | "unsupported" | null = null;
    const spawn = ((command: string[]) => {
      if (command.includes("--dump-single-json")) {
        if (directFailure === "transient") return fakeProcess("", 1);
        if (directFailure === "unsupported") {
          return fakeProcess("", 1, "ERROR: Requested format is not available");
        }
        return fakeProcess(selection(1));
      }
      transcodeProbes += 1;
      return fakeProcess([
        "12",
        "30",
        "https://r1.googlevideo.com/fallback-video?expire=9999999999",
        "https://r1.googlevideo.com/fallback-audio?expire=9999999999",
        "",
      ].join("\n"));
    }) as unknown as typeof Bun.spawn;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      return rangedResponse(url.includes("/video-") ? unsupportedVideo.bytes : unsupportedAudio.bytes, new Headers(init?.headers).get("range"));
    }) as typeof fetch;
    const dependencies = {
      ...directDependencies(spawn, fetchImpl),
      DOWNLOADS_DIR: resolve(root, "downloads"),
      dlEnabled: async () => true,
      dlSettings: async () => ({ experimental_streaming: 1 as const, quality: "best" }),
      readLines: async () => {},
      wait: async () => {},
    };
    const streaming = createDownloadVideoStreaming(dependencies);

    expect(await streaming.getHlsPlaylist(1, "unsupported")).toContain("seg00000.ts");
    expect(transcodeProbes).toBe(1);
    streaming.destroyHlsSession("unsupported", 1);
    directFailure = "transient";
    expect(await streaming.getHlsPlaylist(1, "transient")).toBeNull();
    expect(transcodeProbes).toBe(1);
    directFailure = "unsupported";
    expect(await streaming.getHlsPlaylist(1, "format-unavailable")).toContain("seg00000.ts");
    expect(transcodeProbes).toBe(2);
    streaming.resetHlsScratch();
  });
});
