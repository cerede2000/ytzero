import { describe, expect, test } from "bun:test";
import { DeletedVideoError, PrivateVideoError, type VideoInfo } from "./youtube";
import { checkVideoAvailability, titleUpdateFor } from "./videoAvailabilitySync";

const info = { videoId: "video" } as VideoInfo;

describe("channel video availability checks", () => {
  test("accepts oEmbed success without loading the player response", async () => {
    let playerCalls = 0;
    const result = await checkVideoAvailability("video", {
      oEmbed: async () => ({ availability: "available", title: null }),
      videoInfo: async () => { playerCalls++; return info; },
    });
    expect(result.check).toBe("available");
    expect(playerCalls).toBe(0);
  });

  test("confirms deletion and privacy after oEmbed reports unavailability", async () => {
    expect((await checkVideoAvailability("deleted", {
      oEmbed: async () => ({ availability: "unavailable", title: null }),
      videoInfo: async () => { throw new DeletedVideoError(); },
    })).check).toBe("deleted");
    expect((await checkVideoAvailability("private", {
      oEmbed: async () => ({ availability: "unavailable", title: null }),
      videoInfo: async () => { throw new PrivateVideoError(); },
    })).check).toBe("private");
  });

  test("does not turn an inconclusive oEmbed response into a tombstone", async () => {
    let playerCalls = 0;
    const result = await checkVideoAvailability("video", {
      oEmbed: async () => ({ availability: "unknown", title: null }),
      videoInfo: async () => { playerCalls++; return info; },
    });
    expect(result.check).toBe("unknown");
    expect(playerCalls).toBe(0);
  });

  test("propagates transient player failures instead of marking a deletion", async () => {
    expect(checkVideoAvailability("video", {
      oEmbed: async () => ({ availability: "unavailable", title: null }),
      videoInfo: async () => { throw new Error("YouTube fetch failed (503)"); },
    })).rejects.toThrow("503");
  });

  test("carries back the title oEmbed answered with", async () => {
    // The reason this check is worth anything beyond a verdict: these are the
    // rows the channel scrape can no longer reach, so this is the only answer
    // that will ever correct a title stored while requests went out in English.
    const result = await checkVideoAvailability("WjXDkL1FERs", {
      oEmbed: async () => ({ availability: "available", title: "Donnez-moi 15 minutes." }),
      videoInfo: async () => info,
    });
    expect(result).toEqual({ check: "available", title: "Donnez-moi 15 minutes." });
  });

  test("claims no title from an answer that carried none", async () => {
    // A video confirmed alive by the player rather than by oEmbed has been told
    // nothing about its title, and must not blank the one already stored.
    const result = await checkVideoAvailability("video", {
      oEmbed: async () => ({ availability: "unavailable", title: null }),
      videoInfo: async () => info,
    });
    expect(result).toEqual({ check: "available", title: null });
  });
});

describe("what oEmbed's title is allowed to change", () => {
  const translated = { title: "Culture de champignons shiitakés", title_original: "椎茸の生産から" };

  /*
   * The bug this exists to prevent: oEmbed answers with the uploader's
   * Japanese title for a video this library lists in French, every pass,
   * for ever. Compared against the title on display it looks like a rename
   * every time, and the French title lasted about a day.
   */
  test("is nothing, when the uploader has not touched it", () => {
    expect(titleUpdateFor(translated, "椎茸の生産から")).toBeNull();
  });

  test("is both titles, when the uploader really did rename the video", () => {
    expect(titleUpdateFor(translated, "椎茸の生産から（改訂版）"))
      .toEqual({ write: "椎茸の生産から（改訂版）", retitled: true });
  });

  // Rows written before the column existed have nothing to compare against.
  test("is the uploader's title for a row that has never been told one", () => {
    expect(titleUpdateFor({ title: "椎茸の生産から", title_original: null }, "椎茸の生産から"))
      .toEqual({ write: "椎茸の生産から", retitled: false });
    expect(titleUpdateFor({ title: "Stale English title", title_original: null }, "Titre français"))
      .toEqual({ write: "Titre français", retitled: true });
  });

  test("is nothing when oEmbed carried no title at all", () => {
    expect(titleUpdateFor(translated, null)).toBeNull();
  });
});
