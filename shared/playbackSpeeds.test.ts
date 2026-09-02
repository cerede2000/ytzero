import { describe, expect, test } from "bun:test";
import {
  normalizePlaybackSpeed,
  normalizePlaybackSpeedOptionsSetting,
  parseCustomPlaybackSpeeds,
  resolvePlaybackSpeeds,
  serializeCustomPlaybackSpeeds,
} from "./playbackSpeeds";

describe("custom playback speeds", () => {
  test("accepts bounded values with up to two decimal places", () => {
    expect(normalizePlaybackSpeed("2,3")).toBe("2.3");
    expect(normalizePlaybackSpeed("4.00")).toBe("4");
    expect(normalizePlaybackSpeed("2.345")).toBe(null);
    expect(normalizePlaybackSpeed("4.01")).toBe(null);
  });

  test("stores only sorted custom options", () => {
    expect(serializeCustomPlaybackSpeeds(["2.3", "1", "2.25", "2.3"])).toBe('["2.25","2.3"]');
    expect(parseCustomPlaybackSpeeds('["3","2.3"]')).toEqual(["2.3", "3"]);
  });

  test("rejects malformed settings and tolerates them while reading", () => {
    expect(normalizePlaybackSpeedOptionsSetting('["2.345"]')).toBe(null);
    expect(normalizePlaybackSpeedOptionsSetting("not-json")).toBe(null);
    expect(parseCustomPlaybackSpeeds("not-json")).toEqual([]);
  });

  test("merges defaults, custom speeds, and a persisted current override", () => {
    const speeds = resolvePlaybackSpeeds('["2.3"]', "2.75");
    expect(speeds.includes("2.3")).toBe(true);
    expect(speeds.includes("2.75")).toBe(true);
    expect(speeds.includes("1")).toBe(true);
  });
});
