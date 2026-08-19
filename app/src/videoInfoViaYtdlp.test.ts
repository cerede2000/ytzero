import { describe, expect, test } from "bun:test";
import { audioSourceFromPrinted, printedFormats, progressiveVideoFromPrinted, videoInfoFromYtdlpJson } from "./videoInfoViaYtdlp";

const base = {
  title: "A video",
  channel_id: "UC123",
  channel: "A channel",
  description: "Hello",
  thumbnail: "https://i.ytimg.com/vi/abc/hq.jpg",
  view_count: 1234,
  duration: 754,
  upload_date: "20260813",
  live_status: "not_live",
};

describe("video info from yt-dlp", () => {
  test("reads a plain video", () => {
    expect(videoInfoFromYtdlpJson("abc", base)).toEqual({
      videoId: "abc",
      title: "A video",
      channelId: "UC123",
      channelTitle: "A channel",
      description: "Hello",
      thumbnail: "https://i.ytimg.com/vi/abc/hq.jpg",
      viewCount: 1234,
      publishedAt: "2026-08-13T00:00:00.000Z",
      duration: "12:34",
      liveStatus: "none",
    playableInEmbed: null,
    });
  });

  test("keeps the same duration shape as the player response", () => {
    // Hours are spelled as minutes there, and a mismatch here would show up as
    // a video that suddenly claims to last two minutes instead of two hours.
    expect(videoInfoFromYtdlpJson("abc", { ...base, duration: 7_322 })?.duration).toBe("122:02");
    expect(videoInfoFromYtdlpJson("abc", { ...base, duration: 0 })?.duration).toBeNull();
    expect(videoInfoFromYtdlpJson("abc", { ...base, duration: undefined })?.duration).toBeNull();
  });

  test("carries every live state across", () => {
    const status = (live_status: string) => videoInfoFromYtdlpJson("abc", { ...base, live_status })?.liveStatus;
    expect(status("is_live")).toBe("live");
    expect(status("is_upcoming")).toBe("upcoming");
    expect(status("was_live")).toBe("was_live");
    expect(status("post_live")).toBe("was_live");
    expect(status("not_live")).toBe("none");
    expect(videoInfoFromYtdlpJson("abc", { ...base, live_status: undefined, is_live: true })?.liveStatus).toBe("live");
  });

  test("prefers an exact publication time over the day", () => {
    expect(videoInfoFromYtdlpJson("abc", { ...base, timestamp: 1_786_000_000 })?.publishedAt)
      .toBe(new Date(1_786_000_000_000).toISOString());
    expect(videoInfoFromYtdlpJson("abc", { ...base, upload_date: "" })?.publishedAt).toBeNull();
  });

  test("falls back to the largest thumbnail offered", () => {
    const json = { ...base, thumbnail: undefined, thumbnails: [{ url: "small.jpg" }, { url: "large.jpg" }] };
    expect(videoInfoFromYtdlpJson("abc", json)?.thumbnail).toBe("large.jpg");
  });

  test("refuses an answer with nothing to attach the video to", () => {
    expect(videoInfoFromYtdlpJson("abc", { ...base, channel_id: undefined })).toBeNull();
    expect(videoInfoFromYtdlpJson("abc", { ...base, title: "" })).toBeNull();
  });

  test("takes the uploader when the channel name is missing", () => {
    const json = { ...base, channel: undefined, uploader: "Someone" };
    expect(videoInfoFromYtdlpJson("abc", json)?.channelTitle).toBe("Someone");
  });
});

describe("audio track taken from the same answer", () => {
  const printed = {
    url: "https://r1.googlevideo.com/audio?expire=9999999999",
    headers: JSON.stringify({ "User-Agent": "Chrome/149", Range: "bytes=0-1" }),
    acodec: "mp4a.40.2",
    vcodec: "none",
  };

  test("reads the track and the headers it expects", () => {
    const source = audioSourceFromPrinted(printed);
    expect(source?.url).toContain("googlevideo.com/audio");
    expect(source?.mime).toBe("audio/mp4");
    expect(source?.headers).toEqual({ "User-Agent": "Chrome/149" });
    expect(source?.expiresAt).toBeGreaterThan(Date.now());
  });

  test("refuses anything that is not an audio-only AAC track", () => {
    // The selector falls back to a video when a video has no AAC audio, and
    // handing that to the audio player would play silence or nothing at all.
    expect(audioSourceFromPrinted({ ...printed, acodec: "opus" })).toBeNull();
    expect(audioSourceFromPrinted({ ...printed, vcodec: "avc1.4d401f" })).toBeNull();
    expect(audioSourceFromPrinted({ ...printed, url: "https://example.com/audio" })).toBeNull();
    expect(audioSourceFromPrinted({})).toBeNull();
  });

  test("carries on without headers rather than not at all", () => {
    expect(audioSourceFromPrinted({ ...printed, headers: "NA" })?.headers).toBeUndefined();
  });
});

describe("both playable tracks taken from the same answer", () => {
  const FIELDS = 6;
  const block = (url: string, acodec: string, vcodec: string, ext: string) =>
    [`{"id":"abc"}`, url, "NA", acodec, vcodec, ext].join("\n");
  const audio = block("https://r1.googlevideo.com/audio?expire=9999999999", "mp4a.40.2", "none", "m4a");
  const progressive = block("https://r1.googlevideo.com/muxed?expire=9999999999", "mp4a.40.2", "avc1.42001E", "mp4");

  test("splits what was printed into one entry per format", () => {
    // Asking for two formats repeats the whole print block for each of them.
    const formats = printedFormats(`${audio}\n${progressive}\n`, FIELDS);
    expect(formats).toHaveLength(2);
    expect(audioSourceFromPrinted(formats[0]!)?.url).toContain("/audio");
    expect(progressiveVideoFromPrinted(formats[1]!)?.url).toContain("/muxed");
  });

  test("copes with a video that offers only one of the two", () => {
    // yt-dlp quietly skips a selector that matches nothing rather than failing
    // the call, so the import must count the blocks instead of assuming two.
    const formats = printedFormats(`${audio}\n`, FIELDS);
    expect(formats).toHaveLength(1);
    expect(progressiveVideoFromPrinted(formats[0]!)).toBeNull();
    expect(audioSourceFromPrinted(formats[0]!)).not.toBeNull();
  });

  test("takes only a file the video element can play on its own", () => {
    const muxed = printedFormats(progressive, FIELDS)[0]!;
    expect(progressiveVideoFromPrinted(muxed)?.mime).toBe("video/mp4");
    // Video with no sound, or sound with no video, is what the HLS path
    // assembles from two streams — not something to hand a <video> element.
    expect(progressiveVideoFromPrinted({ ...muxed, acodec: "none" })).toBeNull();
    expect(progressiveVideoFromPrinted({ ...muxed, vcodec: "none" })).toBeNull();
    expect(progressiveVideoFromPrinted({ ...muxed, url: "https://example.com/muxed.mp4" })).toBeNull();
  });

  test("carries who the file was signed for, as the audio track already did", () => {
    const muxed = printedFormats(progressive, FIELDS)[0]!;
    const source = progressiveVideoFromPrinted({
      ...muxed,
      headers: JSON.stringify({ "User-Agent": "Chrome/146 (yt-dlp)", Accept: "text/html" }),
    });
    // A URL resolved with a profile's cookies is refused to a caller that does
    // not look like the client it was minted for.
    expect(source?.headers).toEqual({ "User-Agent": "Chrome/146 (yt-dlp)" });
  });
});
