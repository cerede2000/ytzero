import { describe, expect, test } from "bun:test";
import { effectivePlaybackQueue } from "./watchQueueTakeover";
import type { PlaybackQueueContext } from "./playbackQueue";

const feed: PlaybackQueueContext = { version: 1, kind: "feed", tags: [], showAll: false, sort: "published" };
const userPlaylist: PlaybackQueueContext = { version: 1, kind: "user-playlist", playlistUuid: "u", sort: "added-newest" };
const channelPlaylist: PlaybackQueueContext = { version: 1, kind: "channel-playlist", playlistId: "PL1", sort: "oldest" };

describe("queuing a suggestion while something is playing", () => {
  test("the video on screen becomes the head of the queue", () => {
    // Queuing says what should follow, so it has to reach the video already
    // playing. Left alone, the queue only did something once somebody went and
    // started it from its own menu, and the current video ran out into the feed.
    expect(effectivePlaybackQueue(feed, "playing", ["next-a", "next-b"]))
      .toEqual({ version: 1, kind: "session", ids: ["playing", "next-a", "next-b"] });
  });

  test("with nothing queued, the video keeps the queue it came from", () => {
    expect(effectivePlaybackQueue(feed, "playing", [])).toEqual(feed);
    expect(effectivePlaybackQueue(null, "playing", [])).toBe(null);
  });

  test("a playlist opened on purpose is not interrupted", () => {
    // Somebody chose that order. A queued video does not get to jump into it.
    expect(effectivePlaybackQueue(userPlaylist, "playing", ["next-a"])).toEqual(userPlaylist);
    expect(effectivePlaybackQueue(channelPlaylist, "playing", ["next-a"])).toEqual(channelPlaylist);
  });

  test("the video playing is not queued behind itself", () => {
    // Queuing what is already on screen would otherwise make it its own next.
    expect(effectivePlaybackQueue(feed, "playing", ["playing", "next-a"]))
      .toEqual({ version: 1, kind: "session", ids: ["playing", "next-a"] });
  });

  test("a queue already running picks up what was added since", () => {
    const running: PlaybackQueueContext = { version: 1, kind: "session", ids: ["playing", "next-a"] };
    expect(effectivePlaybackQueue(running, "playing", ["next-a", "next-b"]))
      .toEqual({ version: 1, kind: "session", ids: ["playing", "next-a", "next-b"] });
  });

  test("without a video there is nothing to put at the head", () => {
    expect(effectivePlaybackQueue(feed, undefined, ["next-a"])).toEqual(feed);
  });
});
