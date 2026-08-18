import { describe, expect, test } from "bun:test";
import { isDailymotionMediaUrl, rewriteHlsPlaylist, validDailymotionVideoId } from "./dailymotion";

describe("what counts as a Dailymotion video", () => {
  test("their grammar, not YouTube's", () => {
    expect(validDailymotionVideoId("x88kff6")).toBe(true);
    expect(validDailymotionVideoId("x8e52sz")).toBe(true);
    // An eleven-character YouTube id must not be accepted here: the two id
    // spaces are kept apart deliberately while this is an experiment.
    expect(validDailymotionVideoId("dQw4w9WgXcQ")).toBe(false);
  });

  test("nothing that could be a path or a host", () => {
    expect(validDailymotionVideoId("../../etc/passwd")).toBe(false);
    expect(validDailymotionVideoId("x8/../y")).toBe(false);
    expect(validDailymotionVideoId("")).toBe(false);
  });
});

describe("what the segment proxy will fetch", () => {
  test("Dailymotion's own media hosts", () => {
    expect(isDailymotionMediaUrl("https://vod3.cf.dmcdn.net/sec2(k)/video/1/2/a.ts")).toBe(true);
    expect(isDailymotionMediaUrl("https://s2.dmcdn.net/v/x/x360")).toBe(true);
  });

  test("and nothing else at all", () => {
    // Without this the route is an open proxy: the address arrives in a query
    // parameter, from the page, from anybody.
    expect(isDailymotionMediaUrl("https://evil.example/payload.ts")).toBe(false);
    expect(isDailymotionMediaUrl("https://dmcdn.net.evil.example/x.ts")).toBe(false);
    expect(isDailymotionMediaUrl("http://vod3.cf.dmcdn.net/x.ts")).toBe(false);
    expect(isDailymotionMediaUrl("file:///etc/passwd")).toBe(false);
    expect(isDailymotionMediaUrl("")).toBe(false);
  });
});

describe("pointing the playlist at us", () => {
  const playlistUrl = "https://vod3.cf.dmcdn.net/sec2(k)/video/244/911/498119442_mp4_h264_aac_hq.m3u8";
  const proxy = (absolute: string) => `/api/dailymotion/segment?u=${encodeURIComponent(absolute)}`;

  test("relative segments become absolute addresses behind the proxy", () => {
    // Dailymotion writes them as ../../../frag(1)/… — a player resolving those
    // against our origin would ask us for a path that does not exist.
    const out = rewriteHlsPlaylist("#EXTM3U\n#EXTINF:3.000000,\n../../../frag(1)/video/244/911/a.ts\n", playlistUrl, proxy);
    const segment = out.split("\n")[2];
    expect(segment.startsWith("/api/dailymotion/segment?u=")).toBe(true);
    expect(decodeURIComponent(segment)).toContain("https://vod3.cf.dmcdn.net/sec2(k)/frag(1)/video/244/911/a.ts");
  });

  test("directives are left alone, and blank lines stay blank", () => {
    const out = rewriteHlsPlaylist("#EXTM3U\n#EXT-X-VERSION:5\n\n", playlistUrl, proxy);
    expect(out.split("\n").slice(0, 3)).toEqual(["#EXTM3U", "#EXT-X-VERSION:5", ""]);
  });

  test("a URI inside a directive is rewritten too", () => {
    // No Dailymotion playlist seen here carries a key, and one that did would
    // otherwise ask the browser for an address it cannot reach.
    const out = rewriteHlsPlaylist('#EXT-X-KEY:METHOD=AES-128,URI="../key.bin"\n', playlistUrl, proxy);
    expect(out).toContain('URI="/api/dailymotion/segment?u=');
    expect(decodeURIComponent(out)).toContain("dmcdn.net");
  });
});
