import { describe, expect, test } from "bun:test";
import { isDeletedVideoError, isPrivateVideoError } from "./youtubeVideoAvailability";

/**
 * `recordVideoGone` writes to the database, so what is worth testing here is the
 * judgement in front of the write: which answers from YouTube mean the video is
 * gone, and which mean nothing about it at all.
 */
const deleted = (said: string) => isDeletedVideoError(new Error(said));
const isPrivate = (said: string) => isPrivateVideoError(new Error(said));

describe("what yt-dlp says when a video is gone", () => {
  test("the wordings that mean gone", () => {
    expect(deleted("ERROR: [youtube] tso-GRtccGQ: Video unavailable")).toBe(true);
    expect(deleted("ERROR: [youtube] abc: This video has been removed by the uploader")).toBe(true);
    expect(deleted("ERROR: [youtube] abc: This video was removed for violating the Terms")).toBe(true);
  });

  test("and the one that means private", () => {
    expect(isPrivate("ERROR: [youtube] abc: Private video. Sign in if you've been granted access")).toBe(true);
    expect(deleted("ERROR: [youtube] abc: Private video")).toBe(false);
  });
});

describe("what says nothing about the video", () => {
  test("a refusal is about the address, not the upload", () => {
    // The important one. This arrives for every video while YouTube is turning
    // an address away, and acting on it would empty a library over one bad
    // afternoon — every video asked for, marked gone, none of them gone.
    const refusal = "ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies";
    expect(deleted(refusal)).toBe(false);
    expect(isPrivate(refusal)).toBe(false);
  });

  test("neither does a network or format failure", () => {
    expect(deleted("ERROR: unable to download video data: HTTP Error 500")).toBe(false);
    expect(deleted("ERROR: Requested format is not available")).toBe(false);
    expect(deleted("")).toBe(false);
    expect(isPrivate("ERROR: unable to download video data")).toBe(false);
  });

  test("nor does a video that merely mentions the words in its title", () => {
    // The predicates match a phrase, not a word, so a title is not a verdict.
    expect(deleted("ERROR: [youtube] abc: downloading webpage for 'my private life'")).toBe(false);
  });
});

describe("the page answers in the language it was asked in", () => {
  test("a deleted video is recognised in each of the four", () => {
    // The requests follow the library's language now, so an English-only test
    // stopped recognising a deleted video the day that changed — and the row
    // was never marked. Measured on one deleted video, one request per
    // language, on youtube.com.
    expect(isDeletedVideoError(new Error("Video unavailable"))).toBe(true);
    expect(isDeletedVideoError(new Error("Vidéo non disponible"))).toBe(true);
    expect(isDeletedVideoError(new Error("Video nicht verfügbar"))).toBe(true);
    expect(isDeletedVideoError(new Error("Film niedostępny"))).toBe(true);
  });

  test("accents missing from a page are not a reason to miss it", () => {
    expect(isDeletedVideoError(new Error("Video non disponible"))).toBe(true);
    expect(isDeletedVideoError(new Error("Video nicht verfugbar"))).toBe(true);
  });

  test("and none of them matches a refusal in any language", () => {
    expect(isDeletedVideoError(new Error("Sign in to confirm you’re not a bot"))).toBe(false);
    expect(isDeletedVideoError(new Error("Connectez-vous pour confirmer que vous n’êtes pas un robot"))).toBe(false);
  });
});
