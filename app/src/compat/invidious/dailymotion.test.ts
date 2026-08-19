import { describe, expect, test } from "bun:test";
import { DM_PREFIX, dailymotionIdFrom, prefixedDailymotionId } from "./dailymotion";
import { videoFromDailymotion } from "./shapes";

describe("telling one provider's video from another's", () => {
  test("recognises the prefix and gives back the real id", () => {
    expect(dailymotionIdFrom(`${DM_PREFIX}x8abcde`)).toBe("x8abcde");
    expect(prefixedDailymotionId("x8abcde")).toBe("dm-x8abcde");
  });

  /*
   * A library id must never be read as a Dailymotion one: they are different
   * id spaces, and a lookup in the wrong one answers about whichever video
   * happens to spell the same.
   */
  test("says nothing about an id that is not prefixed", () => {
    expect(dailymotionIdFrom("dQw4w9WgXcQ")).toBeNull();
    expect(dailymotionIdFrom("")).toBeNull();
  });

  /* A prefix in front of nonsense is still nonsense. */
  test("refuses a prefix on something that is not a Dailymotion id", () => {
    expect(dailymotionIdFrom(`${DM_PREFIX}../../etc/passwd`)).toBeNull();
    expect(dailymotionIdFrom(DM_PREFIX)).toBeNull();
  });
});

describe("a Dailymotion video in a client's list", () => {
  const video = {
    videoId: "x8abcde",
    title: "Une vidéo",
    channelTitle: "Une chaîne",
    thumbnail: "https://s1.dmcdn.net/v/abc.jpg",
    durationSeconds: 754.4,
    publishedAt: "2026-03-04T10:00:00Z",
    views: 1234,
  };

  /*
   * The dialect has no field for where a video came from and a client drops
   * what it does not know, so the origin goes where every card and row already
   * draws something: the author line.
   */
  test("says where it came from, in the line that is always drawn", () => {
    expect(videoFromDailymotion(video, "dm-x8abcde").author).toBe("Une chaîne · Dailymotion");
  });

  test("carries the prefixed id, which is what the next tap uses", () => {
    expect(videoFromDailymotion(video, "dm-x8abcde").videoId).toBe("dm-x8abcde");
  });

  test("rounds the duration a client requires as a whole number", () => {
    expect(videoFromDailymotion(video, "dm-x").lengthSeconds).toBe(754);
    expect(videoFromDailymotion({ ...video, durationSeconds: null }, "dm-x").lengthSeconds).toBe(0);
  });

  /* Ours is not a channel the dialect's channel routes can answer about. */
  test("claims no channel of this library", () => {
    expect(videoFromDailymotion(video, "dm-x").authorId).toBe("");
  });
});
