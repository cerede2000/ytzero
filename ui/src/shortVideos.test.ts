import { describe, expect, test } from "bun:test";
import { isShort } from "./shortVideos";

describe("telling a Short from a video nobody has checked", () => {
  test("a confirmed Short is one", () => {
    expect(isShort({ is_short: 1 })).toBe(true);
  });

  test("a confirmed ordinary upload is not", () => {
    expect(isShort({ is_short: 0 })).toBe(false);
  });

  test("an unchecked video is not one either", () => {
    // Shortness is only ever established while syncing a channel, so a video
    // opened from search keeps null for good. Read as "=== 0" this counted as
    // a Short, and the video vanished from every shelf that hides them —
    // including the one holding what somebody had started watching.
    expect(isShort({ is_short: null })).toBe(false);
    expect(isShort({ is_short: undefined as unknown as null })).toBe(false);
  });
});
