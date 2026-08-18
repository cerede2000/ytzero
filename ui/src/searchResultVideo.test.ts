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
    expect(approximatePublishedAt(null, now)).toBe(null);
  });
});

describe("showing a search result as a card", () => {
  const card = videoFromSearchResult(result, { downloadsAllowed: true, downloadsEnabled: true, now });

  test("carries everything a card reads, so nothing has to be fetched", () => {
    expect([card.video_id, card.channel_id, card.channel_title, card.channel_thumbnail, card.duration]).toEqual([
      "XVFUtEh9zrY", "UCSJ4gkVC6NrvII8umztf0Ow", "Lofi Girl", "https://yt3/avatar.jpg", "1:01:01",
    ]);
    expect([card.views, card.downloads_enabled, card.downloads_allowed]).toEqual([4_700_000, true, true]);
  });

  test("says a date it could work out, so the card is not left looking unfinished", () => {
    // An empty published_at is what the card reads as "still being imported":
    // it blurs the thumbnail and spins. A result is not being imported at all.
    expect(card.published_at).toBe("2026-08-14T12:00:00.000Z");
    expect(card.published_at_approximate).toBe(1);
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

describe("a result from a provider that knows the day", () => {
  const base = {
    videoId: "xacfsqi", title: "Un film", thumbnail: "", duration: "44:04",
    channelId: null, channelTitle: "Une chaine", channelAvatar: null,
    viewCount: 12, published: null, watched: 0, watch_position: null, watch_duration: null,
  };
  const context = { downloadsAllowed: false, downloadsEnabled: false, now: Date.parse("2026-08-18T12:00:00.000Z") };

  test("keeps the instant instead of rebuilding one from a phrase", () => {
    // Coarsening an exact date to "N years ago" and back is how a video
    // published two years ago comes out as one: two calendar years are 1.998
    // average ones. A provider that knows the day is believed.
    const video = videoFromSearchResult({ ...base, publishedAt: "2024-08-18T12:00:00.000Z" }, context);
    expect(video.published_at).toBe("2024-08-18T12:00:00.000Z");
    expect(video.published_at_approximate).toBe(0);
  });

  test("and a provider that only says how long ago is still marked approximate", () => {
    const video = videoFromSearchResult({ ...base, published: { value: 2, unit: "year" } }, context);
    expect(video.published_at_approximate).toBe(1);
    expect(typeof video.published_at).toBe("string");
  });
});
