import { describe, expect, test } from "bun:test";
import { createRefusalQuiet, isYouTubeRefusal, YouTubeRefusingError } from "./youtubeRefusalQuiet";
import { isYouTubeRefusalError } from "./youtubeRateLimit";

const REFUSAL = new Error(
  "video info failed: html=videoDetails missing (LOGIN_REQUIRED: Sign in to confirm you're not a bot); "
  + "innertube=HTTP error! status: 400; embed=videoDetails missing (no player response)",
);

describe("video info refusal quiet", () => {
  test("says nothing until something is refused", () => {
    const quiet = createRefusalQuiet({ now: () => 1_000, quietMs: 100 });
    expect(quiet.quiet()).toBe(false);
  });

  test("one refusal holds nothing; a second one does", () => {
    /*
     * A morning of them proved a single refusal means nothing: the same
     * command, the same jar, succeeded every way it was run by hand minutes
     * after the application had been turned away by it.
     */
    const clock = { value: 1_000 };
    const quiet = createRefusalQuiet({ now: () => clock.value, quietMs: 100 });
    quiet.note(REFUSAL);
    expect(quiet.quiet()).toBe(false);
    quiet.note(REFUSAL);
    expect(quiet.quiet()).toBe(true);
    clock.value += 100;
    expect(quiet.quiet()).toBe(false);
  });

  test("and never seals: one attempt is let through per interval", () => {
    /*
     * It used to lift early only on a success, which could not happen — while
     * it held, nothing was attempted. A refusal lasting seconds cost the best
     * part of an hour with no way out but to wait.
     */
    const clock = { value: 1_000 };
    const quiet = createRefusalQuiet({ now: () => clock.value, quietMs: 100, maxQuietMs: 10_000 });
    quiet.note(REFUSAL);
    quiet.note(REFUSAL);
    quiet.note(REFUSAL);
    quiet.note(REFUSAL);
    // Well inside a window that has grown past the base interval.
    expect(quiet.quiet()).toBe(true);
    clock.value += 100;
    expect(quiet.quiet()).toBe(false);
    expect(quiet.quiet()).toBe(true);
  });

  test("recognises the refusal in whichever language it arrives", () => {
    /*
     * Taken from a real pass. The message YouTube returns is translated —
     * this one came back in French — and it is only recognised at all
     * because LOGIN_REQUIRED travels beside it untranslated. Should that
     * token ever go, the wording alone would not match and the whole
     * arrangement would quietly stop noticing.
     */
    expect(isYouTubeRefusal(new Error(
      "video info failed: html=videoDetails missing (LOGIN_REQUIRED: Connectez-vous pour confirmer "
      + "que vous n'êtes pas un robot); innertube=HTTP error! status: 400; embed=videoDetails missing",
    ))).toBe(true);
    // The ones after it are not messages at all but the class itself, which is
    // what carries the meaning: the same words in a plain Error mean nothing.
    expect(isYouTubeRefusal(new YouTubeRefusingError())).toBe(true);
    expect(isYouTubeRefusal(new Error("video info skipped: YouTube is refusing this address"))).toBe(false);
    expect(isYouTubeRefusal(new Error(
      "video info failed: html=videoDetails missing (LOGIN_REQUIRED: Sign in to confirm you're not a bot)",
    ))).toBe(true);
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

    // Two refusals arm it; the window then doubles per refusal after that.
    quiet.note(refusal);
    quiet.note(refusal);
    clock += 91_000;
    expect(quiet.quiet()).toBe(false);

    quiet.note(refusal);
    clock += 91_000;
    // Past the base interval, so the probe is spent here and the hold shows
    // on the next question rather than this one.
    expect(quiet.quiet()).toBe(false);
    expect(quiet.quiet()).toBe(true);

    quiet.note(refusal);
    clock += 5 * 60_000;
    expect(quiet.quiet()).toBe(false);
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

describe("the two refusal detectors, side by side", () => {
  const armed = (message: string) => {
    const quiet = createRefusalQuiet();
    // Twice: the first refusal is remembered so that a second one counts,
    // which is the threshold this holds itself to.
    quiet.note(new Error(message));
    quiet.note(new Error(message));
    return quiet.quiet();
  };

  /*
   * They are armed from the same place now, so where they agree matters: a
   * refusal the gate short-circuits on but the quiet never hears about is a
   * refusal only half the server knows — the cookie order, the subtitles, the
   * audio resolver and the refresher all read the quiet.
   */
  test("agree that being asked to prove you are not a robot is a refusal", () => {
    for (const message of [
      "videoDetails missing (LOGIN_REQUIRED: Sign in to confirm you're not a bot)",
      "videoDetails missing (LOGIN_REQUIRED: Connectez-vous pour confirmer que vous n'êtes pas un robot)",
    ]) {
      expect(isYouTubeRefusalError(new Error(message))).toBe(true);
      expect(armed(message)).toBe(true);
    }
  });

  /*
   * And they part company on purpose. A 429 is being asked to slow down, not
   * being turned away for who you are — the gate waits it out, and the quiet
   * stays silent because offering an account does not answer it.
   */
  test("part company on a rate limit, which credentials do not answer", () => {
    expect(isYouTubeRefusalError(new Error("YouTube fetch failed (429)"))).toBe(true);
    expect(armed("YouTube fetch failed (429)")).toBe(false);
  });

  test("and neither reads an ordinary failure as either", () => {
    expect(isYouTubeRefusalError(new Error("YouTube fetch failed (503)"))).toBe(false);
    expect(armed("YouTube fetch failed (503)")).toBe(false);
  });
});
