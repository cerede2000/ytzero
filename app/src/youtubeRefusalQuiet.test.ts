import { describe, expect, test } from "bun:test";
import { isYouTubeRefusal, videoInfoRefusalQuiet, YouTubeRefusingError } from "./youtubeRefusalQuiet";
import { isYouTubeRefusalError, YouTubeRefusalError, youtubeRefusalGate } from "./youtubeRateLimit";

describe("a refusal, whichever way it arrives", () => {
  test("is recognised as the sentinel this throws while one stands", () => {
    expect(isYouTubeRefusal(new YouTubeRefusingError())).toBe(true);
  });

  /*
   * The gate throws its own while it is holding. A caller that recognised only
   * ours took the wrong branch every time the gate spoke first — asking again
   * with credentials, or remembering an answer it should have declined to keep.
   */
  test("is recognised when the gate is the one that said so", () => {
    expect(isYouTubeRefusal(new YouTubeRefusalError(Date.now() + 1_000))).toBe(true);
  });

  test("is recognised in the wording three real attempts came back with", () => {
    expect(isYouTubeRefusal(new Error("Sign in to confirm you're not a bot"))).toBe(true);
    expect(isYouTubeRefusal(new Error("videoDetails missing (LOGIN_REQUIRED: Vidéo privée)"))).toBe(false);
  });

  test("is not read into an ordinary failure", () => {
    expect(isYouTubeRefusal(new Error("YouTube fetch failed (503)"))).toBe(false);
  });
});

describe("what the rest of the server reads", () => {
  /*
   * One set of books, kept by the gate. This is the reading of them, for
   * everything that decides *how* to ask rather than doing the asking: the
   * cookie order, the subtitles, the audio resolver, the refresher, the
   * metadata backfill.
   */
  test("says nothing is wrong until the gate holds the address", () => {
    videoInfoRefusalQuiet.clear();
    expect(videoInfoRefusalQuiet.quiet()).toBe(false);
  });

  test("says so as soon as the gate does, and stops when an answer gets through", () => {
    videoInfoRefusalQuiet.clear();
    videoInfoRefusalQuiet.note(new Error("Sign in to confirm you're not a bot"));
    expect(videoInfoRefusalQuiet.quiet()).toBe(true);
    videoInfoRefusalQuiet.clear();
    expect(videoInfoRefusalQuiet.quiet()).toBe(false);
  });

  /*
   * And it parts company with the gate on purpose in one place: a 429 is being
   * asked to slow down, not being turned away for who you are. Both hold the
   * address off; only the second changes how the next attempt authenticates.
   */
  test("counts a rate limit as the gate does, since the gate keeps the books", () => {
    videoInfoRefusalQuiet.clear();
    expect(isYouTubeRefusalError(new Error("YouTube fetch failed (429)"))).toBe(true);
    videoInfoRefusalQuiet.note(new Error("YouTube fetch failed (429)"));
    expect(videoInfoRefusalQuiet.quiet()).toBe(true);
    videoInfoRefusalQuiet.clear();
  });

  test("ignores a failure that says nothing about the address", () => {
    videoInfoRefusalQuiet.clear();
    videoInfoRefusalQuiet.note(new Error("YouTube fetch failed (503)"));
    expect(videoInfoRefusalQuiet.quiet()).toBe(false);
  });
});
