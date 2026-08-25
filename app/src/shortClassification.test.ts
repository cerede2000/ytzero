import { describe, expect, test } from "bun:test";
import { durationSeconds, settleIsShort, SHORT_MAX_SECONDS } from "./shortClassification";

const never = async () => { throw new Error("this should have been settled without asking"); };
const asked: string[] = [];
const askYouTube = async (videoId: string) => { asked.push(videoId); return false; };

describe("settling whether a video is a Short", () => {
  test("a duration longer than a Short may run settles it for free", async () => {
    // Nearly every video anybody watches is answered here, without a request:
    // YouTube has never allowed a Short to run past three minutes.
    expect(await settleIsShort("v1", "Une vidéo ordinaire", "26:50", never)).toBe(false);
    expect(await settleIsShort("v2", "Un long format", "1:29:08", never)).toBe(false);
  });

  test("the title says so outright, which is cheaper still", async () => {
    expect(await settleIsShort("v3", "Recette express #shorts", null, never)).toBe(true);
    expect(await settleIsShort("v4", "Astuce #Short", "0:45", never)).toBe(true);
  });

  test("only a video short enough to be in doubt costs a request", async () => {
    asked.length = 0;
    expect(await settleIsShort("v5", "Trois minutes pile", "2:58", askYouTube)).toBe(false);
    expect(await settleIsShort("v6", "Sans durée connue", null, askYouTube)).toBe(false);
    expect(asked).toEqual(["v5", "v6"]);
  });

  test("the boundary is three minutes, not sixty seconds", async () => {
    // The limit was raised, and a rule still written for sixty seconds would
    // send a request for every two-minute video ever imported.
    expect(SHORT_MAX_SECONDS).toBe(181);
    asked.length = 0;
    expect(await settleIsShort("v7", "Deux minutes", "2:00", askYouTube)).toBe(false);
    expect(asked).toEqual(["v7"]);
    expect(await settleIsShort("v8", "Trois minutes et deux secondes", "3:02", never)).toBe(false);
  });

  test("an unanswerable question stays unanswered rather than guessed", async () => {
    expect(await settleIsShort("v9", "Refusé", "0:30", async () => null)).toBe(null);
  });
});

describe("reading a duration", () => {
  test("the forms a video's duration arrives in", () => {
    expect(durationSeconds("26:50")).toBe(1610);
    expect(durationSeconds("1:29:08")).toBe(5348);
    expect(durationSeconds("0:45")).toBe(45);
  });

  test("and what is not one", () => {
    // A live stream has no duration, and a malformed one must not be read as
    // zero seconds — which would look exactly like a Short.
    expect(durationSeconds(null)).toBe(null);
    expect(durationSeconds("")).toBe(null);
    expect(durationSeconds("45")).toBe(null);
    expect(durationSeconds("EN DIRECT")).toBe(null);
  });
});

import { inferIsShortFromMetadata, parseVideoDurationSeconds, shortCheckRetryInterval, shortCheckRetryMinutes } from "./shortClassification";

describe("Shorts metadata classification", () => {
  test("parses catalog clock durations", () => {
    expect(parseVideoDurationSeconds("1:18")).toBe(78);
    expect(parseVideoDurationSeconds("1:02:03")).toBe(3723);
    expect(parseVideoDurationSeconds("3:xx")).toBeNull();
    expect(parseVideoDurationSeconds("180")).toBeNull();
  });

  test("uses only safe local classification facts", () => {
    expect(inferIsShortFromMetadata("Long upload", "3:01")).toBe(false);
    expect(inferIsShortFromMetadata("Long upload", "1:02:03")).toBe(false);
    expect(inferIsShortFromMetadata("Ordinary video", "3:00")).toBeNull();
    expect(inferIsShortFromMetadata("Ordinary video", "0:43")).toBeNull();
    expect(inferIsShortFromMetadata("A CLIP #SHORT", "0:43")).toBe(true);
    expect(inferIsShortFromMetadata("A CLIP #shorts", "3:00")).toBe(true);
  });

  test("prefers the authoritative duration limit over a title hashtag", () => {
    expect(inferIsShortFromMetadata("#shorts compilation", "3:01")).toBe(false);
  });
});

describe("Shorts retry backoff", () => {
  test("grows from half an hour and caps at one day", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(shortCheckRetryMinutes))
      .toEqual([30, 60, 120, 240, 480, 960, 1440, 1440]);
    expect(shortCheckRetryInterval(1)).toBe("+30 minutes");
    expect(shortCheckRetryInterval(99)).toBe("+1440 minutes");
  });
});
