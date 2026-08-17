import { describe, expect, test } from "bun:test";
import { entryFromVideo, videoFromSessionEntry, type SessionQueueEntry } from "./sessionQueue";
import type { Video } from "./apiTypes";

const entry: SessionQueueEntry = {
  videoId: "g9GL7kpG1KQ",
  title: "IL A FAIT LA GUERRE EN IRAK… ET JE VIENS DE L’ACHETER !",
  thumbnail: "https://i.ytimg.com/vi/g9GL7kpG1KQ/hqdefault.jpg",
  channelTitle: "GLB",
  duration: "34:10",
};

describe("drawing a queued video the library has never seen", () => {
  test("everything a card needs to name and picture it", () => {
    // A suggestion queued from the panel has no row until its import finishes,
    // and that import is only started by the queuing. Anything that waited for
    // the row showed nothing at the moment somebody said what should play next.
    const video = videoFromSessionEntry(entry);
    expect(video.video_id).toBe("g9GL7kpG1KQ");
    expect(video.title).toBe(entry.title);
    expect(video.thumbnail).toBe(entry.thumbnail);
    expect(video.channel_title).toBe("GLB");
    expect(video.duration).toBe("34:10");
  });

  test("and nothing it would have to invent", () => {
    // Claiming it was watched, or private, or a Short, would be worse than
    // admitting the row has not arrived: the card would lie about it.
    const video = videoFromSessionEntry(entry);
    expect(video.watched).toBe(0);
    expect(video.is_private).toBe(0);
    expect(video.is_short).toBe(0);
    expect(video.live_status).toBe("none");
    expect(video.watch_position).toBe(null);
  });

  test("a round trip keeps the video recognisable", () => {
    const back = entryFromVideo(videoFromSessionEntry(entry));
    expect(back).toEqual(entry);
  });

  test("a video with no duration stays without one", () => {
    expect(videoFromSessionEntry({ ...entry, duration: null }).duration).toBe(null);
  });
});

describe("what the queue stores of a video", () => {
  test("only the five fields a card is drawn from", () => {
    const video = { video_id: "a", title: "t", thumbnail: "th", channel_title: "c", duration: "1:00" } as Video;
    expect(entryFromVideo(video)).toEqual({
      videoId: "a", title: "t", thumbnail: "th", channelTitle: "c", duration: "1:00",
    });
  });
});
