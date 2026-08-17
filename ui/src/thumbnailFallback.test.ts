import { describe, expect, test } from "bun:test";
import { plainYouTubeThumbnail, thumbnailCandidates } from "./thumbnailFallback";

/**
 * The URL that started this, taken from a row on the reporting instance. The
 * uploader changed the thumbnail; the numbered name went with it, and the
 * stored one answers 404 with or without its signature.
 */
const DEAD = "https://i.ytimg.com/vi/WjXDkL1FERs/hq720_custom_3.jpg?sqp=CPS0i9QG&rs=AOn4CLBj";
const PLAIN = "https://i.ytimg.com/vi/WjXDkL1FERs/hqdefault.jpg";
const DEARROW = "https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=WjXDkL1FERs&time=637";

describe("the name that does not rotate", () => {
  test("is derived from a rotating one", () => {
    expect(plainYouTubeThumbnail(DEAD)).toBe(PLAIN);
    expect(plainYouTubeThumbnail("https://i.ytimg.com/vi/WjXDkL1FERs/maxresdefault.jpg")).toBe(PLAIN);
  });

  test("is not offered in place of itself", () => {
    expect(plainYouTubeThumbnail(PLAIN)).toBe(null);
    expect(plainYouTubeThumbnail(`${PLAIN}?sqp=abc`)).toBe(null);
  });

  test("is found whichever host served the image", () => {
    // Checked in the browser: rows imported from a feed carry i2/i4, not i.
    // Matching only `i.ytimg.com` would have left most of a library uncovered.
    expect(plainYouTubeThumbnail("https://i4.ytimg.com/vi/WjXDkL1FERs/hq720_custom_3.jpg")).toBe(PLAIN);
    expect(plainYouTubeThumbnail("https://img.youtube.com/vi/WjXDkL1FERs/maxresdefault.jpg")).toBe(PLAIN);
  });

  test("is not invented for an address that is not YouTube's", () => {
    expect(plainYouTubeThumbnail(DEARROW)).toBe(null);
    expect(plainYouTubeThumbnail("")).toBe(null);
    expect(plainYouTubeThumbnail("/local/thumb.jpg")).toBe(null);
  });
});

describe("what a card tries, in order", () => {
  test("a dead stored thumbnail still has somewhere to go", () => {
    // The whole point: no replacement is configured here, so before this there
    // was nothing after `src` and the card drew a broken placeholder.
    expect(thumbnailCandidates(DEAD)).toEqual([DEAD, PLAIN]);
  });

  test("a replacement is tried first, then what it stands in for", () => {
    expect(thumbnailCandidates(DEARROW, DEAD)).toEqual([DEARROW, DEAD, PLAIN]);
  });

  test("the plain name is derived from the image, not from the replacement", () => {
    // DeArrow's URL carries a video id too, but deriving from it would guess at
    // an address YouTube never served. The last real image is what is asked.
    expect(thumbnailCandidates(DEARROW, DEAD)[2]).toBe(PLAIN);
    expect(thumbnailCandidates(DEARROW)).toEqual([DEARROW]);
  });

  test("nothing is offered twice", () => {
    expect(thumbnailCandidates(PLAIN, PLAIN)).toEqual([PLAIN]);
    expect(thumbnailCandidates(DEAD, PLAIN)).toEqual([DEAD, PLAIN]);
  });

  test("a healthy thumbnail is still the first thing shown", () => {
    expect(thumbnailCandidates(PLAIN)[0]).toBe(PLAIN);
  });
});
