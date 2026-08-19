import { beforeEach, describe, expect, test } from "bun:test";
import { forgetPlayback, notePlayback, playbackActive, shouldRunNow } from "./playbackActivity";

const NOW = 1_800_000_000_000;

beforeEach(forgetPlayback);

describe("knowing that somebody is watching", () => {
  test("says nobody is when nothing has been served", () => {
    expect(playbackActive(NOW)).toBe(false);
  });

  test("says somebody is for a while after the last bytes went out", () => {
    notePlayback(NOW);
    expect(playbackActive(NOW + 1_000)).toBe(true);
    expect(playbackActive(NOW + 89_000)).toBe(true);
  });

  test("stops saying so once the player has gone quiet", () => {
    notePlayback(NOW);
    expect(playbackActive(NOW + 91_000)).toBe(false);
  });
});

describe("a scheduled pass falling during playback", () => {
  /*
   * The background work is all yt-dlp, and a pass is a handful of extractions.
   * Landing them in the seconds after somebody presses play is what turned a
   * fetch that runs at twenty-five megabytes a second into one running at two
   * hundred kilobytes.
   */
  test("stands aside", () => {
    expect(shouldRunNow({ lastRunAt: NOW }, NOW + 60_000, true)).toBe(false);
  });

  test("runs when nobody is watching", () => {
    expect(shouldRunNow({ lastRunAt: NOW }, NOW + 60_000, false)).toBe(true);
  });

  /* Standing aside for ever is not standing aside; it is not running. */
  test("runs anyway once it has waited long enough", () => {
    expect(shouldRunNow({ lastRunAt: NOW }, NOW + 31 * 60_000, true)).toBe(true);
  });

  test("counts that wait from when it last ran, not from the last skip", () => {
    const job = { lastRunAt: NOW };
    expect(shouldRunNow(job, NOW + 10 * 60_000, true)).toBe(false);
    expect(shouldRunNow(job, NOW + 20 * 60_000, true)).toBe(false);
    expect(shouldRunNow(job, NOW + 30 * 60_000, true)).toBe(true);
  });
});
