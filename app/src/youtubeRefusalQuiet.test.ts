import { describe, expect, test } from "bun:test";
import { createRefusalQuiet } from "./youtubeRefusalQuiet";

const REFUSAL = new Error(
  "video info failed: html=videoDetails missing (LOGIN_REQUIRED: Sign in to confirm you're not a bot); "
  + "innertube=HTTP error! status: 400; embed=videoDetails missing (no player response)",
);

describe("video info refusal quiet", () => {
  test("says nothing until something is refused", () => {
    const quiet = createRefusalQuiet({ now: () => 1_000, quietMs: 100 });
    expect(quiet.quiet()).toBe(false);
  });

  test("holds after the caller is turned away", () => {
    const clock = { value: 1_000 };
    const quiet = createRefusalQuiet({ now: () => clock.value, quietMs: 100 });
    quiet.note(REFUSAL);
    expect(quiet.quiet()).toBe(true);
    clock.value += 100;
    expect(quiet.quiet()).toBe(false);
  });

  test("ignores failures that are about the video, not the caller", () => {
    // A deleted or region-blocked video says nothing about the address, and
    // holding on it would stop every other lookup for a minute and a half.
    const quiet = createRefusalQuiet({ now: () => 1_000, quietMs: 100 });
    quiet.note(new Error("video info failed: html=YouTube fetch failed (404)"));
    expect(quiet.quiet()).toBe(false);
  });

  test("lets a success end the spell early", () => {
    const quiet = createRefusalQuiet({ now: () => 1_000, quietMs: 100 });
    quiet.note(REFUSAL);
    quiet.clear();
    expect(quiet.quiet()).toBe(false);
  });
});
