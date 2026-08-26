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

function fixture(quality = "best") {
  const requests: string[] = [];
  const commands: string[][] = [];
  const streaming = createDownloadVideoProgressiveStreaming({
    YTDLP: "yt-dlp",
    downloadCookiesConfigured: () => false,
    downloadCookiesFile: (userId) => `/cookies/${userId}.txt`,
    ytdlpStatus: async () => "test",
    dlSettings: async () => ({ quality }),
    spawn: ((command: string[]) => { commands.push(command); return {
      stdout: new Response('https://r1.googlevideo.com/video?expire=9999999999\nmp4\navc1.64001f\nmp4a.40.2\n{"User-Agent":"yt-dlp-agent","Accept-Language":"en-US"}\n').body!,
      stderr: new Response("").body!, exited: Promise.resolve(0), kill: () => {},
    }; }) as unknown as typeof Bun.spawn,
    fetchImpl: (async (_input, init) => {
      const range = new Headers(init?.headers).get("range");
      requests.push(range ?? "");
      return ranged(range);
    }) as typeof fetch,
  });
  return { streaming, requests, commands };
}

describe("progressive direct video stream", () => {
  test("keeps the progressive fallback within the selected quality limit", async () => {
    const { streaming, commands } = fixture("480");
    expect((await streaming.getDirectVideoResponse(1, "quality", "bytes=0-1"))?.status).toBe(206);
    const selector = commands[0][commands[0].indexOf("-f") + 1];
    expect(selector).toContain("[height<=480]");
    expect(selector).toContain("[protocol^=http]");
    expect(selector).not.toContain("22/");
    expect(commands[0]).toContain("--skip-download");
  });
  test("turns missing and open-ended browser ranges into finite upstream requests with Content-Length", async () => {
    const { streaming, requests } = fixture();
    const first = await streaming.getDirectVideoResponse(1, "video", null);
    expect(first?.status).toBe(206);
    expect(first?.headers.get("content-length")).toBe("64");
    expect(first?.headers.get("content-range")).toBe("bytes 0-63/64");
    expect(requests).toEqual([`bytes=0-${8 * 1024 * 1024 - 1}`]);

    const response = await video.getDirectVideoResponse(1, "abc", "bytes=0-63");

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

    const response = await video.getDirectVideoResponse(1, "refused-video", "bytes=0-63");

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

    const response = await video.getDirectVideoResponse(1, "redirected", "bytes=0-63");

    expect(response?.status).toBe(206);
    expect(asked[1]).toContain("/moved");
  });

  test("plays a file the import already resolved, without asking again", async () => {
    // The import runs yt-dlp over this very video seconds earlier, and the
    // file this player streams is in that answer.
    let resolutions = 0;
    const asked: string[] = [];
    const video = factory({
      spawn: (() => { resolutions++; return fakeProcess(`${url("late")}\nmp4\n`); }) as unknown as typeof Bun.spawn,
      fetchImpl: (async (input: unknown) => { asked.push(String(input)); return chunk(64); }) as unknown as typeof fetch,
    });

    video.primeDirectVideoSource(1, "primed", { url: url("early"), mime: "video/mp4", expiresAt: Date.now() + 60_000 });
    const response = await video.getDirectVideoResponse(1, "primed", "bytes=0-63");

    expect(response?.status).toBe(206);
    expect(resolutions).toBe(0);
    expect(asked[0]).toContain("/early");
  });

  test("keeps one profile's signed file to itself", async () => {
    // The URL was signed for whoever asked, and cookies belong to a profile.
    let resolutions = 0;
    const video = factory({
      spawn: (() => { resolutions++; return fakeProcess(`${url("own")}\nmp4\n`); }) as unknown as typeof Bun.spawn,
      fetchImpl: (async () => chunk(64)) as unknown as typeof fetch,
    });

    video.primeDirectVideoSource(1, "shared", { url: url("first"), mime: "video/mp4", expiresAt: Date.now() + 60_000 });
    await video.getDirectVideoResponse(2, "shared", "bytes=0-63");

    expect(resolutions).toBe(1);
  });

  test("says so when a granted chunk never arrives", async () => {
    // The one ending that named no reason: upstream allowed the range, the
    // body then failed to arrive, and the player got a bare 502 while the log
    // showed a retry ladder that had apparently succeeded.
    const granted = new Response(new Uint8Array(64), {
      status: 206,
      headers: { "Content-Range": "bytes 0-63/1000" },
    });
    Object.defineProperty(granted, "arrayBuffer", {
      value: () => Promise.reject(new Error("connection reset by peer")),
    });
    const video = factory({
      spawn: (() => fakeProcess(`${url("video")}\nmp4\n`)) as unknown as typeof Bun.spawn,
      fetchImpl: (async () => granted) as unknown as typeof fetch,
    });

    expect(await video.getDirectVideoResponse(1, "abc", "bytes=0-63")).toBeNull();
  });

  test("refuses to proxy a host that is not YouTube's media edge", async () => {
    const video = factory({
      spawn: (() => fakeProcess("https://example.com/anything.mp4\nmp4\n")) as unknown as typeof Bun.spawn,
      fetchImpl: (async () => chunk(64)) as unknown as typeof fetch,
    });

    expect(await video.getDirectVideoResponse(1, "elsewhere", "bytes=0-63")).toBeNull();
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
