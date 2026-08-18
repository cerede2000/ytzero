import { describe, expect, test } from "bun:test";
import { cleanTitle, dropDuplicateVideos, isDailymotionMediaUrl, masterPlaylist, plainDescription, reSignSegmentUrl, rewriteHlsPlaylist, searchDailymotion, subtitlePlaylist, subtitlesFromMetadata, validDailymotionVideoId } from "./dailymotion";

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

describe("the manifest iOS reads", () => {
  const track = { lang: "fr-auto", label: "Français (auto)", url: "/api/dm/subs/fr-auto/index.m3u8" };
  const rendition = { width: 360, height: 640, codecs: "avc1.42001e,mp4a.40.2", bitrate: 460_560 };

  test("can declare a rendition, and the routes no longer ask it to", () => {
    // Kept because the builder still supports it, and skipped in practice: a
    // declared rendition is owned by whichever player is running, and the three
    // of them disagree. The page fetches the same captions as a file instead.
    const master = masterPlaylist("/api/dm/media.m3u8", [track], rendition);
    expect(master).toContain('#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs"');
    expect(master.trimEnd().endsWith("/api/dm/media.m3u8")).toBe(true);
  });

  test("states what the rendition is, for the stricter of the two readers", () => {
    expect(masterPlaylist("/m.m3u8", [track], rendition))
      .toContain('#EXT-X-STREAM-INF:BANDWIDTH=460560,RESOLUTION=360x640,CODECS="avc1.42001e,mp4a.40.2",SUBTITLES="subs"');
  });

  test("offers the captions without imposing them", () => {
    // Reported from an iPhone: switched off, then a ten-second skip brought
    // them back. DEFAULT is re-read on the way, and AUTOSELECT would do the
    // same from the phone's accessibility settings. Off has to mean off.
    const master = masterPlaylist("/m.m3u8", [track], rendition);
    expect(master).toContain("AUTOSELECT=NO,DEFAULT=NO");
    expect(master).not.toContain("DEFAULT=YES");
  });

  test("and says nothing it does not know", () => {
    expect(masterPlaylist("/m.m3u8", [])).toContain("#EXT-X-STREAM-INF:BANDWIDTH=800000\n");
    expect(masterPlaylist("/m.m3u8", [])).not.toContain("SUBTITLES");
  });

  test("a caption file is presented as a playlist that outlasts the video", () => {
    // A segment shorter than the video ends the track early; players do not
    // mind one that runs past the end.
    const playlist = subtitlePlaylist("/api/dm/subs/fr-auto", 4507.57);
    expect(playlist).toContain("#EXT-X-TARGETDURATION:4508");
    expect(playlist).toContain("#EXTINF:4508.000,");
    expect(playlist).toContain("#EXT-X-ENDLIST");
  });

  test("with a day's worth of duration when nobody said", () => {
    expect(subtitlePlaylist("/t.vtt", null)).toContain("#EXT-X-TARGETDURATION:86400");
  });
});

describe("a segment whose signature has aged out", () => {
  const stale = "https://vod3.cf.dmcdn.net/sec2(OLD)/video/244/911/498119442_mp4_h264_aac_hq/1400.m4s";
  const freshStream = "https://vod3.cf.dmcdn.net/sec2(NEW)/video/244/911/498119442_mp4_h264_aac_hq.m3u8";

  test("is asked for again under the new one", () => {
    // The playlist the player is holding has the old signature in every line,
    // and it does not reload a VOD playlist. Seeking past what is buffered is
    // where that shows: everything not yet fetched answers 403.
    expect(reSignSegmentUrl(stale, freshStream))
      .toBe("https://vod3.cf.dmcdn.net/sec2(NEW)/video/244/911/498119442_mp4_h264_aac_hq/1400.m4s");
  });

  test("only the signature changes", () => {
    const rebuilt = reSignSegmentUrl(stale, freshStream) ?? "";
    expect(rebuilt.endsWith("/1400.m4s")).toBe(true);
    expect(rebuilt.includes("OLD")).toBe(false);
  });

  test("and nothing is rebuilt from an address that carries none", () => {
    expect(reSignSegmentUrl(stale, "https://vod3.cf.dmcdn.net/plain/index.m3u8")).toBe(null);
    expect(reSignSegmentUrl("https://vod3.cf.dmcdn.net/plain/0.m4s", freshStream)).toBe(null);
  });

  test("nor when the signature has not moved", () => {
    // Retrying the identical address is a second refusal, not a repair.
    const same = "https://vod3.cf.dmcdn.net/sec2(NEW)/video/244/911/x/1.m4s";
    expect(reSignSegmentUrl(same, freshStream)).toBe(null);
  });
});

describe("a description written in markup", () => {
  test("keeps its paragraphs and loses its tags", () => {
    // Printed verbatim, "<br />" is what the reader sees — which is what the
    // page did before this.
    expect(plainDescription("Un drame.<br /><br />Suite <b>ici</b>."))
      .toBe("Un drame.\n\nSuite ici.");
  });

  test("renders no markup of theirs, ever", () => {
    expect(plainDescription('<img src=x onerror="alert(1)">texte')).toBe("texte");
  });

  test("and an absent one is empty rather than undefined", () => {
    expect(plainDescription(undefined)).toBe("");
    expect(plainDescription(42)).toBe("");
  });
});

describe("the same video, listed several times", () => {
  test("copies are caught on the start of the title and the duration", () => {
    // Measured on one video's suggestions: five results were the same film
    // under five ids, differing past the fiftieth character — which is where a
    // card's ellipsis falls anyway.
    const kept = dropDuplicateVideos([
      { title: "Changing My Fate Starts With a Marriage Certificate-💔 | Emotional Drama | A", durationSeconds: 8093, id: "a" },
      { title: "Changing my fate starts with a marriage certificate 💔 | Emotional drama | B", durationSeconds: 8093, id: "b" },
      { title: "Une autre histoire", durationSeconds: 120, id: "c" },
    ]);
    expect(kept.map((item) => item.id)).toEqual(["a", "c"]);
  });

  test("two clips that merely share an opening are both kept", () => {
    // Real, from the same list: two TV spots for one film, thirty seconds and
    // seventeen. A title-only rule loses one of them.
    const kept = dropDuplicateVideos([
      { title: "Underworld : Nouvelle Ère (Underworld : Awakening) - Spot TV: Ne…", durationSeconds: 30, id: "long" },
      { title: "Underworld : Nouvelle Ère (Underworld : Awakening) - Spot TV: Ne…", durationSeconds: 17, id: "court" },
    ]);
    expect(kept.map((item) => item.id)).toEqual(["long", "court"]);
  });

  test("the first is the one kept, which is the order they ranked them in", () => {
    const kept = dropDuplicateVideos([
      { title: "X", durationSeconds: 10, id: "premier" },
      { title: "x!", durationSeconds: 10, id: "second" },
    ]);
    expect(kept.map((item) => item.id)).toEqual(["premier"]);
  });

  test("and a title of nothing but punctuation is dropped rather than kept as a key", () => {
    expect(dropDuplicateVideos([{ title: "—", durationSeconds: 1 }, { title: "…", durationSeconds: 2 }])).toEqual([]);
  });
});

describe("their page title on the end of a video title", () => {
  test("is taken off", () => {
    expect(cleanTitle("Homeless to Billionaire's Wife - Video Dailymotion"))
      .toBe("Homeless to Billionaire's Wife");
    // Any dash they use, not only the ASCII one.
    expect(cleanTitle("Un titre — Video dailymotion  ")).toBe("Un titre");
  });

  test("and a title that merely mentions them is left alone", () => {
    expect(cleanTitle("Dailymotion, l'histoire d'un site")).toBe("Dailymotion, l'histoire d'un site");
  });
});
