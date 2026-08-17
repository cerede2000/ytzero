import { describe, expect, test } from "bun:test";
import { videoInfoFromPlayerResponse } from "./youtube";

const player = (extra: Record<string, unknown>) => ({
  videoDetails: { videoId: "abc", title: "A video", channelId: "UC1", author: "Someone", shortDescription: "" },
  ...extra,
});

describe("knowing in advance that the embed will refuse", () => {
  test("reads the uploader's answer from the watch page", () => {
    // The refusal is the uploader's setting, not a failure: waiting for the
    // iframe to report it means showing YouTube's own notice first, a dead end
    // presented as the outcome, when the direct stream was always the answer.
    expect(videoInfoFromPlayerResponse("abc", player({ playabilityStatus: { status: "OK", playableInEmbed: false } })).playableInEmbed).toBe(false);
    expect(videoInfoFromPlayerResponse("abc", player({ playabilityStatus: { status: "OK", playableInEmbed: true } })).playableInEmbed).toBe(true);
  });

  test("an answer that does not carry it leaves it unknown", () => {
    // The InnerTube and embed fallbacks say nothing about embedding, and an
    // unknown read as a refusal would send every video the long way round.
    expect(videoInfoFromPlayerResponse("abc", player({ playabilityStatus: { status: "OK" } })).playableInEmbed).toBe(null);
    expect(videoInfoFromPlayerResponse("abc", player({})).playableInEmbed).toBe(null);
  });

  test("the detail block is read too, since that is where it sometimes sits", () => {
    const info = videoInfoFromPlayerResponse("abc", {
      videoDetails: { videoId: "abc", title: "A video", channelId: "UC1", author: "Someone", shortDescription: "", playableInEmbed: false },
    });
    expect(info.playableInEmbed).toBe(false);
  });
});
