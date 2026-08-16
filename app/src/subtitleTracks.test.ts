import { describe, expect, test } from "bun:test";
import { pickSubtitleEntry, safeSubtitleUrl, subtitleTracksFromMaps } from "./subtitleTracks";

const timedtext = (lang: string, fmt: string) =>
  `https://www.youtube.com/api/timedtext?v=abc&expire=9999999999&signature=sig&lang=${lang}&fmt=${fmt}`;
const hlsPlaylist = "https://manifest.googlevideo.com/api/manifest/hls_timedtext_playlist/expire/9999999999/x/y";

const track = (lang: string, ext: string, url = timedtext(lang, ext), name = lang.toUpperCase()) =>
  ({ ext, url, name });

describe("choosing how to read a language", () => {
  test("prefers the one file a track element can play", () => {
    // YouTube offers the same captions as json3, srv1..3, ttml, srt and vtt.
    // Only WebVTT goes straight onto a <track>.
    const picked = pickSubtitleEntry([
      track("en", "json3"), track("en", "srv1"), track("en", "ttml"),
      track("en", "srt"), track("en", "vtt"),
    ]);
    expect(picked).toEqual({ url: timedtext("en", "vtt"), ext: "vtt" });
  });

  test("passes over the playlist of caption segments", () => {
    // Some videos also list the track as HLS. It is playable, but it is not
    // one file to hand over, and the plain URL beside it is.
    const picked = pickSubtitleEntry([
      { ext: "vtt", url: hlsPlaylist, name: "English" },
      track("en", "vtt"),
    ]);
    expect(picked?.url).toBe(timedtext("en", "vtt"));
  });

  test("takes SubRip when there is no WebVTT, and nothing it cannot read", () => {
    expect(pickSubtitleEntry([track("en", "srt")])?.ext).toBe("srt");
    expect(pickSubtitleEntry([track("en", "json3"), track("en", "ttml")])).toBeNull();
    expect(pickSubtitleEntry([])).toBeNull();
  });

  test("refuses a host this proxy has no business fetching", () => {
    expect(safeSubtitleUrl(timedtext("en", "vtt"))).not.toBeNull();
    expect(safeSubtitleUrl("https://rr1.googlevideo.com/timedtext?x=1")).not.toBeNull();
    expect(safeSubtitleUrl("https://example.com/captions.vtt")).toBeNull();
    expect(safeSubtitleUrl("http://www.youtube.com/api/timedtext")).toBeNull();
    expect(safeSubtitleUrl("not a url")).toBeNull();
    expect(pickSubtitleEntry([{ ext: "vtt", url: "https://example.com/x.vtt" }])).toBeNull();
  });
});

describe("the languages a video offers", () => {
  const supported = new Set(["en", "fr", "de"]);

  test("keeps a video's own captions whatever language they are in", () => {
    const tracks = subtitleTracksFromMaps({ ja: [track("ja", "vtt")] }, {}, supported);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({ lang: "ja", automatic: false });
  });

  test("keeps machine captions only in the languages the app offers", () => {
    // YouTube lists a hundred and sixty translations of them, which is a menu
    // nobody reads.
    const automatic = Object.fromEntries(
      ["en", "fr", "zu", "yo", "xh"].map((lang) => [lang, [track(lang, "vtt")]]),
    );
    const tracks = subtitleTracksFromMaps({}, automatic, supported);
    expect(tracks.map((t) => t.lang)).toEqual(["en", "fr"]);
    expect(tracks.every((t) => t.automatic)).toBe(true);
  });

  test("prefers what the author wrote over what a machine heard", () => {
    const tracks = subtitleTracksFromMaps(
      { en: [track("en", "vtt", timedtext("en", "vtt"), "English")] },
      { en: [track("en", "vtt", timedtext("en", "vtt"), "English (auto-generated)")] },
      supported,
    );
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({ name: "English", automatic: false });
  });

  test("drops a language it has no readable file for", () => {
    expect(subtitleTracksFromMaps({ en: [track("en", "json3")] }, {}, supported)).toEqual([]);
    expect(subtitleTracksFromMaps({}, {}, supported)).toEqual([]);
  });
});
