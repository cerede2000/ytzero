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

describe("saying it once", () => {
  test("announces the refusal and the recovery, not every lookup between", () => {
    const changes: boolean[] = [];
    const quiet = createRefusalQuiet({ now: () => 1_000, quietMs: 100, onChange: (r) => changes.push(r) });
    quiet.note(REFUSAL);
    quiet.note(REFUSAL);
    quiet.note(REFUSAL);
    expect(changes).toEqual([true]);
    quiet.clear();
    quiet.clear();
    expect(changes).toEqual([true, false]);
  });
});

describe("a refusal that does not lift", () => {
  const refusal = new Error("LOGIN_REQUIRED: Sign in to confirm you're not a bot");

  test("waits longer each time, instead of asking every three minutes for ever", () => {
    // The metadata backfill runs every three minutes and the quiet was ninety
    // seconds, so it had always expired by the next batch: one lookup per
    // batch, refused, for hours, on an address YouTube was rate-limiting.
    let clock = 0;
    const quiet = createRefusalQuiet({ now: () => clock });

    quiet.note(refusal);
    clock += 91_000;
    expect(quiet.quiet()).toBe(false);

    quiet.note(refusal);
    clock += 91_000;
    expect(quiet.quiet()).toBe(true);

    clock += 90_000;
    expect(quiet.quiet()).toBe(false);
    quiet.note(refusal);
    clock += 5 * 60_000;
    expect(quiet.quiet()).toBe(true);
  });

  test("stops growing rather than going quiet for a day", () => {
    let clock = 0;
    const quiet = createRefusalQuiet({ now: () => clock });
    for (let attempt = 0; attempt < 20; attempt++) quiet.note(refusal);
    clock += 31 * 60_000;
    expect(quiet.quiet()).toBe(false);
  });

  test("goes back to ninety seconds the moment something gets through", () => {
    let clock = 0;
    const quiet = createRefusalQuiet({ now: () => clock });
    for (let attempt = 0; attempt < 5; attempt++) quiet.note(refusal);
    quiet.clear();

    quiet.note(refusal);
    clock += 91_000;
    expect(quiet.quiet()).toBe(false);
  });
});
