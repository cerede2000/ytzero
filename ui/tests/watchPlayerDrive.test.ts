import { describe, expect, test } from "bun:test";
import { shouldDriveYouTubePlayer } from "../src/pages/watchPlayerDrive";

const state = (over: Partial<Parameters<typeof shouldDriveYouTubePlayer>[0]> = {}) => ({
  playerKind: "youtube",
  membersOnlyNotice: false,
  videoUnavailable: false,
  ...over,
});

describe("whether the watch page still has an embed to drive", () => {
  test("it does while the embed is what is being shown", () => {
    expect(shouldDriveYouTubePlayer(state())).toBe(true);
  });

  /*
   * The bug this exists to prevent: the IFrame API replaces the element it is
   * given, so when the page swaps that element for the "could not be loaded"
   * notice, React removes a node that is no longer there and the iframe plays
   * on behind the notice — picture and sound, with nobody in audio mode.
   *
   * The embed is destroyed by this effect's cleanup, and a cleanup only runs
   * when the effect re-runs, so this answer has to be one of the things it
   * watches.
   */
  test("it does not once the page has given up on the video", () => {
    expect(shouldDriveYouTubePlayer(state({ videoUnavailable: true }))).toBe(false);
  });

  test("it does not behind the members-only notice either", () => {
    expect(shouldDriveYouTubePlayer(state({ membersOnlyNotice: true }))).toBe(false);
  });

  test("it does not for the players the page renders itself", () => {
    for (const playerKind of ["local", "stream", "loading", "choice", "waiting", "blocked"]) {
      expect(shouldDriveYouTubePlayer(state({ playerKind }))).toBe(false);
    }
  });
});
