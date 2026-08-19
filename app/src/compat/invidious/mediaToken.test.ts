import { describe, expect, test } from "bun:test";
import { mediaSignature, mediaTokenValid } from "./mediaToken";

const SECRET = "0123456789abcdef".repeat(4);
const NOW = 1_800_000_000_000;
const SOON = Math.floor(NOW / 1000) + 3600;

const sign = (resource: string, videoId: string, expires = SOON) =>
  mediaSignature(SECRET, resource, videoId, expires);

describe("media links", () => {
  test("opens what it was minted for", () => {
    expect(mediaTokenValid(SECRET, "media", "abc", String(SOON), sign("media", "abc"), NOW)).toBe(true);
  });

  /*
   * The point of putting the resource in the signature: playback and subtitles
   * are separate grants, so a link handed to a player cannot be edited into a
   * request for anything else the same video has.
   */
  test("does not open a different resource of the same video", () => {
    expect(mediaTokenValid(SECRET, "caption:fr", "abc", String(SOON), sign("media", "abc"), NOW)).toBe(false);
  });

  test("does not open a different video", () => {
    expect(mediaTokenValid(SECRET, "media", "other", String(SOON), sign("media", "abc"), NOW)).toBe(false);
  });

  test("stops working once it has expired", () => {
    const past = Math.floor(NOW / 1000) - 1;
    expect(mediaTokenValid(SECRET, "media", "abc", String(past), sign("media", "abc", past), NOW)).toBe(false);
  });

  test("is refused when signed with another key", () => {
    const other = mediaSignature("f".repeat(64), "media", "abc", SOON);
    expect(mediaTokenValid(SECRET, "media", "abc", String(SOON), other, NOW)).toBe(false);
  });

  /* Anything malformed is a no, never a throw: this runs on unauthenticated input. */
  test("refuses nonsense instead of failing", () => {
    for (const [expires, signature] of [
      [undefined, undefined], ["", ""], ["abc", sign("media", "abc")],
      [String(SOON), "zz"], [String(SOON), "a".repeat(63)], [String(SOON), "A".repeat(64)],
    ] as [string | undefined, string | undefined][]) {
      expect(mediaTokenValid(SECRET, "media", "abc", expires, signature, NOW)).toBe(false);
    }
  });
});
