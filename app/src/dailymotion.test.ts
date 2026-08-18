import { describe, expect, test } from "bun:test";
import { isDailymotionMediaUrl, rewriteHlsPlaylist, searchDailymotion, subtitlesFromMetadata, validDailymotionVideoId } from "./dailymotion";

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

describe("what the search is allowed to offer", () => {
  const answering = (list: unknown[]) =>
    (async () => new Response(JSON.stringify({ list }), { status: 200 })) as unknown as typeof fetch;
  const live = { id: "x3rddqb", title: "Live one", allow_embed: true, private: false, status: "published" };

  test("a result that forbids embedding is not offered", async () => {
    // Measured on "film complet": one result in fifteen answered 404 on its own
    // endpoint, and it was the only one with allow_embed false. A card for it
    // is a card that cannot be pressed.
    const dead = { id: "xakotqq", title: "Dead one", allow_embed: false, private: false, status: "published" };
    const videos = await searchDailymotion("film complet", 15, answering([live, dead]));
    expect(videos.map((video) => video.videoId)).toEqual(["x3rddqb"]);
  });

  test("nor a private one, nor one still being processed", async () => {
    const videos = await searchDailymotion("x", 15, answering([
      live,
      { id: "x111111", allow_embed: true, private: true, status: "published" },
      { id: "x222222", allow_embed: true, private: false, status: "processing" },
    ]));
    expect(videos.map((video) => video.videoId)).toEqual(["x3rddqb"]);
  });

  test("an answer that says nothing about it is taken at face value", async () => {
    // Older entries carry no status at all; refusing those would empty the page.
    const videos = await searchDailymotion("x", 15, answering([{ id: "xzlj6y", title: "Old" }]));
    expect(videos.map((video) => video.videoId)).toEqual(["xzlj6y"]);
  });
});

describe("the caption tracks worth offering", () => {
  const srt = "https://static2.dmcdn.net/sec2(x)/subtitle/fr-auto.srt";
  const segmented = "https://www.dailymotion.com/cdn/subtitle/video/xacfsqi/fr-auto.m3u8?sec=x";

  test("a plain file is taken and named for a menu", () => {
    expect(subtitlesFromMetadata({ subtitles: { "fr-auto": [{ ext: "srt", url: srt }] } }))
      .toEqual([{ lang: "fr-auto", label: "Français (auto)", url: srt, srt: true }]);
  });

  test("the segmented form of the same captions is left alone", () => {
    // Dailymotion publishes both. Stitching WebVTT fragments that each carry a
    // header and a timestamp map goes wrong as drift rather than as an error,
    // and the plain file says the same thing.
    expect(subtitlesFromMetadata({ subtitles: { und: [{ ext: "vtt", url: segmented }] } })).toEqual([]);
  });

  test("one track per language, the first that can be used", () => {
    const tracks = subtitlesFromMetadata({
      subtitles: { "fr-auto": [{ ext: "vtt", url: segmented }, { ext: "srt", url: srt }] },
    });
    expect(tracks.map((track) => track.url)).toEqual([srt]);
  });

  test("automatic captions are offered when there is nothing else", () => {
    expect(subtitlesFromMetadata({ automatic_captions: { en: [{ ext: "vtt", url: "https://static2.dmcdn.net/s/en.vtt" }] } })
      .map((track) => track.label)).toEqual(["Anglais"]);
  });

  test("and nothing is fetched from somewhere that is not Dailymotion", () => {
    expect(subtitlesFromMetadata({ subtitles: { fr: [{ ext: "srt", url: "https://evil.example/track.srt" }] } })).toEqual([]);
  });

  test("a video with no captions is not an error", () => {
    expect(subtitlesFromMetadata({})).toEqual([]);
    expect(subtitlesFromMetadata({ subtitles: {} })).toEqual([]);
  });
});
