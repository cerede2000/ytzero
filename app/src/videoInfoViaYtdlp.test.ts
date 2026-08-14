import { describe, expect, test } from "bun:test";
import { videoInfoFromYtdlpJson } from "./videoInfoViaYtdlp";

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
