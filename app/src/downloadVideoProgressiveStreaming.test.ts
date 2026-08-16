import { describe, expect, test } from "bun:test";
import { createDownloadVideoProgressiveStreaming } from "./downloadVideoProgressiveStreaming";

const futureExpiry = 9_999_999_999;
const url = (name: string) => `https://r1.googlevideo.com/${name}?expire=${futureExpiry}`;

function fakeProcess(stdout: string, stderr = "", exitCode = 0): ReturnType<typeof Bun.spawn> {
  return {
    stdout: new Response(stdout).body!,
    stderr: new Response(stderr).body!,
    exited: Promise.resolve(exitCode),
    kill: () => {},
  } as unknown as ReturnType<typeof Bun.spawn>;
}

function chunk(bytes: number, start = 0, total = 1_000_000): Response {
  return new Response(new Uint8Array(bytes), {
    status: 206,
    headers: {
      "Content-Length": String(bytes),
      "Content-Range": `bytes ${start}-${start + bytes - 1}/${total}`,
    },
  });
}

function factory(overrides: Partial<Parameters<typeof createDownloadVideoProgressiveStreaming>[0]> = {}) {
  return createDownloadVideoProgressiveStreaming({
    YTDLP: "yt-dlp",
    downloadCookiesConfigured: () => false,
    downloadCookiesFile: (userId) => `/cookies/${userId}.txt`,
    ytdlpStatus: async () => "test",
    spawn: (() => ({
      stdout: new Response('https://r1.googlevideo.com/video?expire=9999999999\nmp4\navc1.64001f\nmp4a.40.2\n{"User-Agent":"yt-dlp-agent","Accept-Language":"en-US"}\n').body!,
      stderr: new Response("").body!, exited: Promise.resolve(0), kill: () => {},
    })) as unknown as typeof Bun.spawn,
    fetchImpl: (async (_input, init) => {
      const range = new Headers(init?.headers).get("range");
      requests.push(range ?? "");
      return ranged(range);
    }) as typeof fetch,
  });
}

describe("direct video streaming", () => {
  test("waits out a fresh URL rather than buying another one", async () => {
    // A signed googlevideo URL answers 403 to everything for about a second
    // after it is issued, and then serves. Resolving a replacement costs
    // several seconds and hands back a URL just as new.
    let resolutions = 0;
    let asks = 0;
    const video = factory({
      spawn: (() => { resolutions++; return fakeProcess(`${url("video")}\nmp4\n`); }) as unknown as typeof Bun.spawn,
      fetchImpl: (async () => {
        asks++;
        return asks < 3 ? new Response(null, { status: 403 }) : chunk(64);
      }) as unknown as typeof fetch,
    });

    const response = await video.getVideoResponse(1, "abc", "bytes=0-63");

    expect(response?.status).toBe(206);
    expect(asks).toBe(3);
    expect(resolutions).toBe(1);
  });

  test("tries the profile's cookies when the address itself is refused", async () => {
    // Anonymous is asked first because it offers more formats. While YouTube
    // is turning the address away, that attempt cannot ever succeed, and a
    // single attempt left the player with nothing to play.
    const attempts: boolean[] = [];
    const video = factory({
      downloadCookiesConfigured: () => true,
      spawn: ((command: string[]) => {
        const withCookies = command.includes("--cookies");
        attempts.push(withCookies);
        return withCookies
          ? fakeProcess(`${url("video")}\nmp4\n`)
          : fakeProcess("", "ERROR: Sign in to confirm you're not a bot", 1);
      }) as unknown as typeof Bun.spawn,
      fetchImpl: (async () => chunk(64)) as unknown as typeof fetch,
    });

    const response = await video.getVideoResponse(1, "refused-video", "bytes=0-63");

    expect(attempts).toEqual([false, true]);
    expect(response?.status).toBe(206);
  });

  test("follows googlevideo's own redirect instead of handing back nothing", async () => {
    const asked: string[] = [];
    const video = factory({
      spawn: (() => fakeProcess(`${url("video")}\nmp4\n`)) as unknown as typeof Bun.spawn,
      fetchImpl: (async (input: unknown) => {
        asked.push(String(input));
        return asked.length === 1
          ? new Response(null, { status: 302, headers: { location: url("moved") } })
          : chunk(64);
      }) as unknown as typeof fetch,
    });

    const response = await video.getVideoResponse(1, "redirected", "bytes=0-63");

    expect(response?.status).toBe(206);
    expect(asked[1]).toContain("/moved");
  });

  test("refuses to proxy a host that is not YouTube's media edge", async () => {
    const video = factory({
      spawn: (() => fakeProcess("https://example.com/anything.mp4\nmp4\n")) as unknown as typeof Bun.spawn,
      fetchImpl: (async () => chunk(64)) as unknown as typeof fetch,
    });

    expect(await video.getVideoResponse(1, "elsewhere", "bytes=0-63")).toBeNull();
  });

  test("uses yt-dlp headers for every range request", async () => {
    const agents: string[] = [];
    const languages: string[] = [];
    const streaming = createDownloadVideoProgressiveStreaming({
      YTDLP: "yt-dlp",
      downloadCookiesConfigured: () => true,
      downloadCookiesFile: () => "cookies.txt",
      ytdlpStatus: async () => "test",
      spawn: (() => ({
        stdout: new Response('https://r1.googlevideo.com/video?expire=9999999999\nmp4\navc1.64001f\nmp4a.40.2\n{"User-Agent":"signed-client","Accept-Language":"pl-PL"}\n').body!,
        stderr: new Response("").body!, exited: Promise.resolve(0), kill: () => {},
      })) as unknown as typeof Bun.spawn,
      fetchImpl: (async (_input, init) => {
        const headers = new Headers(init?.headers);
        agents.push(headers.get("user-agent") ?? "");
        languages.push(headers.get("accept-language") ?? "");
        return ranged(headers.get("range"));
      }) as typeof fetch,
    });

    expect((await streaming.getDirectVideoResponse(1, "video", "bytes=0-0"))?.status).toBe(206);
    expect(agents).toEqual(["signed-client"]);
    expect(languages).toEqual(["pl-PL"]);
  });

  test("retries a fresh refused URL before resolving a replacement", async () => {
    let spawns = 0;
    let fetches = 0;
    const streaming = createDownloadVideoProgressiveStreaming({
      YTDLP: "yt-dlp",
      downloadCookiesConfigured: () => true,
      downloadCookiesFile: () => "cookies.txt",
      ytdlpStatus: async () => "test",
      now: () => 1_000,
      spawn: (() => {
        spawns++;
        return {
          stdout: new Response('https://r1.googlevideo.com/video?expire=9999999999\nmp4\navc1.64001f\nmp4a.40.2\n{"User-Agent":"signed-client"}\n').body!,
          stderr: new Response("").body!, exited: Promise.resolve(0), kill: () => {},
        };
      }) as unknown as typeof Bun.spawn,
      fetchImpl: (async (_input, init) => {
        fetches++;
        return fetches === 1
          ? new Response(null, { status: 403 })
          : ranged(new Headers(init?.headers).get("range"));
      }) as typeof fetch,
    });

    expect((await streaming.getDirectVideoResponse(1, "video", "bytes=0-0"))?.status).toBe(206);
    expect(fetches).toBe(2);
    expect(spawns).toBe(1);
  });
});
