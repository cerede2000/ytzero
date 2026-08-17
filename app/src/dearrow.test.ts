import { describe, expect, test } from "bun:test";
import { deArrowHashPrefix, deArrowFallbackTimestamp, selectDeArrowBranding } from "./dearrow";

describe("DeArrow branding", () => {
  test("uses the documented four-character SHA-256 prefix", () => {
    expect(deArrowHashPrefix("dQw4w9WgXcQ")).toBe("5f6b");
  });

  test("selects trusted replacement titles and thumbnails", () => {
    expect(selectDeArrowBranding("video-id", {
      titles: [{ title: "A >clear title", original: false, votes: 2, locked: false }],
      thumbnails: [{ timestamp: 42.5, original: false, votes: 0, locked: false }],
    })).toEqual({
      title: "A clear title",
      thumbnail: "https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=video-id&time=42.5",
    });
  });

  test("keeps originals and rejects negatively rated candidates", () => {
    expect(selectDeArrowBranding("video-id", {
      titles: [{ title: "Untrusted", original: false, votes: -1, locked: false }],
      thumbnails: [{ timestamp: null, original: true, votes: 4, locked: false }],
    })).toEqual({ title: null, thumbnail: null });
  });
});

describe("when the community has chosen no frame", () => {
  test("the point DeArrow returns for every video is used instead", () => {
    // Measured on a channel of 213 videos: not one had a community thumbnail,
    // and every one had this. Stopping at the community's choice left the
    // setting doing nothing at all there — the uploader's image stayed, which
    // is the one the reader turned it on to avoid.
    const branding = selectDeArrowBranding("abc", { thumbnails: [], randomTime: 0.5, videoDuration: 600 });
    expect(branding.thumbnail).toBe("https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=abc&time=300");
  });

  test("a chosen frame still wins over it", () => {
    const branding = selectDeArrowBranding("abc", {
      thumbnails: [{ original: false, votes: 3, locked: false, timestamp: 42 }],
      randomTime: 0.5,
      videoDuration: 600,
    });
    expect(branding.thumbnail).toBe("https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=abc&time=42");
  });

  test("without a duration there is nothing to ask for", () => {
    // The fraction alone is not a time, and the uploader's image is the honest
    // answer rather than a guess at second zero.
    expect(selectDeArrowBranding("abc", { randomTime: 0.5 }).thumbnail).toBe(null);
    expect(selectDeArrowBranding("abc", { randomTime: 0.5, videoDuration: 0 }).thumbnail).toBe(null);
    expect(selectDeArrowBranding("abc", { videoDuration: 600 }).thumbnail).toBe(null);
  });

  test("a fraction outside the video is not a frame in it", () => {
    expect(deArrowFallbackTimestamp({ randomTime: 1.4, videoDuration: 600 })).toBe(null);
    expect(deArrowFallbackTimestamp({ randomTime: -0.1, videoDuration: 600 })).toBe(null);
    expect(deArrowFallbackTimestamp(undefined)).toBe(null);
  });
});
