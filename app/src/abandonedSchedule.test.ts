import { describe, expect, test } from "bun:test";
import { fetchLiveInfo, isAbandonedSchedule } from "./youtube";

// The real timestamp carried by a stream that has occupied its channel's /live
// slot since 2016, measured on youtube.com.
const JULY_2016 = "1467550680";
const NOW = Date.parse("2026-08-17T12:00:00Z");
const now = () => NOW;

describe("a scheduled stream that was never going to happen", () => {
  test("ten years past its start, it is not upcoming", () => {
    expect(isAbandonedSchedule(JULY_2016, now)).toBe(true);
  });

  test("a stream running late is still upcoming", () => {
    // Streams start late and premieres get pushed. Only a week settles it.
    const hoursAgo = String(Math.floor((NOW - 6 * 60 * 60_000) / 1000));
    const daysAgo = String(Math.floor((NOW - 3 * 24 * 60 * 60_000) / 1000));
    expect(isAbandonedSchedule(hoursAgo, now)).toBe(false);
    expect(isAbandonedSchedule(daysAgo, now)).toBe(false);
  });

  test("and one announced for next week certainly is", () => {
    expect(isAbandonedSchedule(String(Math.floor((NOW + 7 * 24 * 60 * 60_000) / 1000)), now)).toBe(false);
  });

  test("no schedule at all is not evidence of abandonment", () => {
    expect(isAbandonedSchedule(null, now)).toBe(false);
    expect(isAbandonedSchedule(undefined, now)).toBe(false);
    expect(isAbandonedSchedule("", now)).toBe(false);
    expect(isAbandonedSchedule("0", now)).toBe(false);
    expect(isAbandonedSchedule("pas un nombre", now)).toBe(false);
  });
});

describe("discovering a channel's current livestream", () => {
  const page = (scheduledStartTime: string) => `
    <link rel="canonical" href="https://www.youtube.com/watch?v=cPkbpMRYC34">
    <meta name="title" content="NOUVELLE BANNIÈRE + PAPOTAGE">
    <script>var x = {"isUpcoming":true,"scheduledStartTime":"${scheduledStartTime}"};</script>
  `;
  const respond = (html: string) => (async () => new Response(html, { status: 200 })) as unknown as typeof fetch;

  test("an abandoned schedule holds the slot, so it is not reported as live", async () => {
    // Announced on every refresh, it can never fall out of the active set —
    // which is the only way the demotion that clears finished streams runs. It
    // sat on the Live page for ten years for want of this.
    const original = globalThis.fetch;
    globalThis.fetch = respond(page(JULY_2016));
    try {
      expect(await fetchLiveInfo("UCBmGPY1gJ4XnXfek849BjTA")).toBe(null);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a stream genuinely scheduled is still reported", async () => {
    const soon = String(Math.floor((Date.now() + 24 * 60 * 60_000) / 1000));
    const original = globalThis.fetch;
    globalThis.fetch = respond(page(soon));
    try {
      const info = await fetchLiveInfo("UCBmGPY1gJ4XnXfek849BjTA");
      expect(info?.videoId).toBe("cPkbpMRYC34");
      expect(info?.isUpcoming).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });
});
