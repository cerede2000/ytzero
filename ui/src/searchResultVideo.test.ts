import { describe, expect, test } from "bun:test";
import { approximatePublishedAt, videoFromSearchResult } from "./searchResultVideo";
import type { SearchResult } from "./apiTypes";

const result: SearchResult = {
  videoId: "XVFUtEh9zrY",
  title: "summer lofi & chill beats",
  thumbnail: "https://i.ytimg.com/large.jpg",
  duration: "1:01:01",
  channelId: "UCSJ4gkVC6NrvII8umztf0Ow",
  channelTitle: "Lofi Girl",
  channelAvatar: "https://yt3/avatar.jpg",
  viewCount: 4_700_000,
  published: { value: 2, unit: "day" },
  watched: 0,
  watch_position: null,
  watch_duration: null,
};

const now = Date.parse("2026-08-16T12:00:00.000Z");

describe("when a search result was published", () => {
  test("reads back the only thing YouTube said", () => {
    expect(approximatePublishedAt({ value: 2, unit: "day" }, now)).toBe("2026-08-14T12:00:00.000Z");
    expect(approximatePublishedAt({ value: 3, unit: "hour" }, now)).toBe("2026-08-16T09:00:00.000Z");
  });

  test("has nothing to say about a result that gave no date", () => {
    expect(approximatePublishedAt(null, now)).toBeNull();
  });
});

describe("showing a search result as a card", () => {
  test("carries everything a card reads, so nothing has to be fetched", () => {
    const video = videoFromSearchResult(result, { downloadsAllowed: true, downloadsEnabled: true, now });
    expect(video).toMatchObject({
      video_id: "XVFUtEh9zrY",
      channel_id: "UCSJ4gkVC6NrvII8umztf0Ow",
      channel_title: "Lofi Girl",
      channel_thumbnail: "https://yt3/avatar.jpg",
      duration: "1:01:01",
      views: 4_700_000,
      published_at: "2026-08-14T12:00:00.000Z",
      downloads_enabled: true,
    });
  });

  test("says a date it could work out, so the card is not left looking unfinished", () => {
    // An empty published_at is what the card reads as "still being imported":
    // it blurs the thumbnail and spins. A result is not being imported at all.
    const video = videoFromSearchResult(result, { downloadsAllowed: true, downloadsEnabled: true, now });
    expect(video.published_at).toBeTruthy();
    expect(video.published_at_approximate).toBe(1);
  });

  test("says what is already downloaded, so nothing offers to fetch it twice", () => {
    const video = videoFromSearchResult({ ...result, download_status: "done" }, { downloadsAllowed: true, downloadsEnabled: true, now });
    expect(video.download_status).toBe("done");
  });

  test("leaves the channel empty when the result named none", () => {
    const video = videoFromSearchResult({ ...result, channelId: null }, { downloadsAllowed: false, downloadsEnabled: false, now });
    expect(video.channel_id).toBe("");
  });
});
