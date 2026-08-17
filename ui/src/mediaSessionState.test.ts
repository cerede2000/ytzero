import { describe, expect, test } from "bun:test";
import { mediaPlaybackState } from "./mediaSessionState";

describe("what the lock screen is told about playback", () => {
  test("an element that is running is playing", () => {
    // The case that was never stated. The session is re-registered whenever
    // what it can reach changes, its cleanup declares the session over, and
    // nothing said otherwise — so the controls vanished from the lock screen
    // while the sound carried on, which is the one state a listener with a
    // phone in their pocket cannot do anything about.
    expect(mediaPlaybackState({ paused: false, ended: false })).toBe("playing");
  });

  test("a paused element is paused, not gone", () => {
    expect(mediaPlaybackState({ paused: true, ended: false })).toBe("paused");
  });

  test("a finished element is gone", () => {
    expect(mediaPlaybackState({ paused: true, ended: true })).toBe("none");
    expect(mediaPlaybackState({ paused: false, ended: true })).toBe("none");
  });

  test("no element at all is gone", () => {
    expect(mediaPlaybackState(null)).toBe("none");
    expect(mediaPlaybackState(undefined)).toBe("none");
  });
});
