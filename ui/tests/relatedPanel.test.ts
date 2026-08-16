import { describe, expect, test } from "bun:test";
import { withSuggestions } from "../src/relatedPanel";
import type { SearchResult, Video } from "../src/apiTypes";

const local = (videoId: string) => ({ video_id: videoId, title: videoId }) as Video;
const suggestion = (videoId: string): SearchResult => ({
  videoId,
  title: videoId,
  thumbnail: "",
  duration: "10:00",
  channelId: null,
  channelTitle: "Someone",
  channelAvatar: null,
  viewCount: null,
  published: null,
  watched: 0,
  watch_position: null,
  watch_duration: null,
});

describe("the panel beside a video", () => {
  test("is YouTube's alone once YouTube has answered", () => {
    // The library's waterfall runs to fifteen whether or not there are
    // suggestions, and its last steps only ask what arrived recently. Leaving
    // it under the suggestions is what made the panel read as the library's.
    const panel = withSuggestions([local("mine-a"), local("mine-b")], [suggestion("yt-a")]);
    expect(panel.map((video) => video.video_id)).toEqual(["yt-a"]);
  });

  test("is the library's when YouTube offers nothing", () => {
    expect(withSuggestions([local("mine-a")], []).map((video) => video.video_id)).toEqual(["mine-a"]);
    expect(withSuggestions([local("mine-a")], undefined).map((video) => video.video_id)).toEqual(["mine-a"]);
  });

  test("keeps the order YouTube gave", () => {
    const panel = withSuggestions([], [suggestion("first"), suggestion("second"), suggestion("third")]);
    expect(panel.map((video) => video.video_id)).toEqual(["first", "second", "third"]);
  });

  test("marks a suggestion as external, so acting on it imports it first", () => {
    const [card] = withSuggestions([], [suggestion("yt-a")]);
    expect(card.external).toBe(1);
    expect(card.downloads_allowed).toBe(false);
  });
});
