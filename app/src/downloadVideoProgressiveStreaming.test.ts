import { describe, expect, test } from "bun:test";
import { createDownloadVideoProgressiveStreaming } from "./downloadVideoProgressiveStreaming";

const bytes = Uint8Array.from({ length: 64 }, (_, index) => index);

function ranged(range: string | null): Response {
  const match = range?.match(/^bytes=(\d+)-(\d+)$/);
  if (!match) return new Response(null, { status: 400 });
  const start = Number(match[1]);
  if (start >= bytes.byteLength) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.byteLength}` } });
  const end = Math.min(Number(match[2]), bytes.byteLength - 1);
  const body = bytes.slice(start, end + 1);
  return new Response(body, { status: 206, headers: {
    "Content-Length": String(body.byteLength),
    "Content-Range": `bytes ${start}-${end}/${bytes.byteLength}`,
  } });
}

function fixture() {
  const requests: string[] = [];
  const streaming = createDownloadVideoProgressiveStreaming({
    YTDLP: "yt-dlp",
    downloadCookiesConfigured: () => false,
    downloadCookiesFile: () => "cookies.txt",
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
  return { streaming, requests };
}

describe("progressive direct video stream", () => {
  test("turns missing and open-ended browser ranges into finite upstream requests with Content-Length", async () => {
    const { streaming, requests } = fixture();
    const first = await streaming.getDirectVideoResponse(1, "video", null);
    expect(first?.status).toBe(206);
    expect(first?.headers.get("content-length")).toBe("64");
    expect(first?.headers.get("content-range")).toBe("bytes 0-63/64");
    expect(requests).toEqual([`bytes=0-${8 * 1024 * 1024 - 1}`]);

    const second = await streaming.getDirectVideoResponse(1, "video", "bytes=10-");
    expect(second?.headers.get("content-range")).toBe("bytes 10-63/64");
    expect(requests.at(-1)).toBe(`bytes=10-${10 + 8 * 1024 * 1024 - 1}`);
  });

  test("rejects suffix and malformed ranges without contacting Google Video", async () => {
    const { streaming, requests } = fixture();
    expect((await streaming.getDirectVideoResponse(1, "video", "bytes=-10"))?.status).toBe(416);
    expect((await streaming.getDirectVideoResponse(1, "video", "bytes=4-2"))?.status).toBe(416);
    expect(requests).toEqual([]);
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
