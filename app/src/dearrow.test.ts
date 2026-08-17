import { describe, expect, test } from "bun:test";
import { deArrowHashPrefix, selectDeArrowBranding } from "./dearrow";

const THUMB = "https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=";

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

  test("keeps original titles and rejects negatively rated candidates", () => {
    expect(selectDeArrowBranding("video-id", {
      titles: [{ title: "Untrusted", original: false, votes: -1, locked: false }],
      thumbnails: [{ timestamp: null, original: true, votes: 4, locked: false }],
    })).toEqual({ title: null, thumbnail: `${THUMB}video-id` });
  });
});

describe("when the community has chosen no frame", () => {
  test("the service is asked for one without being told where", () => {
    // The report this comes from: on a followed channel, the branding API
    // carried no entry at all for any of 12 videos, so there was no timestamp
    // to build a URL from and every card kept the uploader's thumbnail — the
    // one the reader turned this on to avoid. Untimed, the service picks the
    // frame itself and answers 200.
    expect(selectDeArrowBranding("abc", {}).thumbnail).toBe(`${THUMB}abc`);
    expect(selectDeArrowBranding("abc", undefined).thumbnail).toBe(`${THUMB}abc`);
    expect(selectDeArrowBranding("abc", { thumbnails: [] }).thumbnail).toBe(`${THUMB}abc`);
  });

  test("an untrusted or original submission does not name a frame either", () => {
    expect(selectDeArrowBranding("abc", {
      thumbnails: [{ original: true, votes: 9, locked: false, timestamp: 42 }],
    }).thumbnail).toBe(`${THUMB}abc`);
    expect(selectDeArrowBranding("abc", {
      thumbnails: [{ original: false, votes: -2, locked: false, timestamp: 42 }],
    }).thumbnail).toBe(`${THUMB}abc`);
  });

  test("a chosen frame is still asked for by its timestamp", () => {
    // Submitted frames are already rendered, so naming one costs nothing —
    // and it is the frame somebody picked rather than the one that came up.
    expect(selectDeArrowBranding("abc", {
      thumbnails: [{ original: false, votes: 3, locked: false, timestamp: 42 }],
    }).thumbnail).toBe(`${THUMB}abc&time=42`);
  });

  test("a submission with no timestamp is not asked for at second zero", () => {
    expect(selectDeArrowBranding("abc", {
      thumbnails: [{ original: false, votes: 3, locked: false, timestamp: null }],
    }).thumbnail).toBe(`${THUMB}abc`);
  });
});
