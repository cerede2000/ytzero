import { describe, expect, test } from "bun:test";
import { DeletedVideoError, PrivateVideoError, type VideoInfo } from "./youtube";
import { checkVideoAvailability } from "./videoAvailabilitySync";

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
