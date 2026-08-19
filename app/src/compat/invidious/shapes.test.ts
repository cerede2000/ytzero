import { describe, expect, test } from "bun:test";
import {
  channelFromSearchResult,
  labelledQualities,
  commentsFrom,
  videoFromRow,
  videoFromSearchResult,
  subscriberCount,
  videoThumbnails,
  type VideoRowLike,
} from "./shapes";
import type { SearchResult } from "../../youtube";

const row: VideoRowLike = {
  video_id: "abc12345678",
  title: "Un titre",
  description: "",
  thumbnail: "https://i.ytimg.com/vi/abc12345678/hq720_custom_2.jpg",
  published_at: "2026-03-04T10:00:00Z",
  live_status: "none",
  views: 1234,
  likes: 56,
  duration: "12:34",
  channel_id: "UCchannel",
  channel_title: "La chaîne",
};

describe("library rows as client documents", () => {
  test("gives a length in seconds, which clients require", () => {
    expect(videoFromRow(row).lengthSeconds).toBe(754);
  });

  /*
   * The field is not optional in Yattee's model, and a single entry without it
   * fails the decode of the entire list it arrived in — one video with no
   * duration would empty a whole channel page.
   */
  test("still gives one when the row has no duration", () => {
    expect(videoFromRow({ ...row, duration: null }).lengthSeconds).toBe(0);
  });

  test("carries the channel as the author", () => {
    const video = videoFromRow(row);
    expect(video.author).toBe("La chaîne");
    expect(video.authorId).toBe("UCchannel");
  });

  test("publishes a unix timestamp, and omits it when there is no date", () => {
    expect(videoFromRow(row).published).toBe(Math.floor(Date.parse("2026-03-04T10:00:00Z") / 1000));
    expect(videoFromRow({ ...row, published_at: null }).published).toBeUndefined();
  });

  test("says a live video is live", () => {
    expect(videoFromRow({ ...row, live_status: "live" }).liveNow).toBe(true);
    expect(videoFromRow({ ...row, live_status: "upcoming" }).isUpcoming).toBe(true);
  });
});

describe("thumbnails", () => {
  test("offers the uploader's own image first", () => {
    const [first] = videoThumbnails(row.video_id, row.thumbnail);
    expect(first.url).toBe(row.thumbnail!);
  });

  test("never lists the same image twice", () => {
    const stored = "https://i.ytimg.com/vi/abc12345678/hqdefault.jpg";
    const urls = videoThumbnails(row.video_id, stored).map((thumbnail) => thumbnail.url);
    expect(urls.filter((url) => url === stored)).toHaveLength(1);
  });

  test("falls back to names derived from the id", () => {
    expect(videoThumbnails(row.video_id, null)[0].url).toContain("maxresdefault.jpg");
  });

  /* Two entries claiming the same quality is a list a client picks from wrongly. */
  test("does not claim a quality twice", () => {
    const stored = "https://i.ytimg.com/vi/abc12345678/hqdefault.jpg";
    const qualities = videoThumbnails(row.video_id, stored).map((thumbnail) => thumbnail.quality);
    expect(new Set(qualities).size).toBe(qualities.length);
    expect(videoThumbnails(row.video_id, stored)[0].url).toBe(stored);
  });
});

describe("subscriber counts", () => {
  test("reads the magnitudes YouTube writes", () => {
    expect(subscriberCount("1.2M subscribers")).toBe(1_200_000);
    expect(subscriberCount("12 k abonnés")).toBe(12_000);
    expect(subscriberCount("1,2 M d'abonnés")).toBe(1_200_000);
    expect(subscriberCount("845")).toBe(845);
  });

  test("says nothing rather than guessing", () => {
    expect(subscriberCount(null)).toBe(0);
    expect(subscriberCount("abonnés")).toBe(0);
  });
});

describe("search hits as client documents", () => {
  const result: SearchResult = {
    videoId: "xyz12345678",
    title: "Résultat",
    thumbnail: "https://i.ytimg.com/vi/xyz12345678/hqdefault.jpg",
    duration: "1:02:03",
    channelId: null,
    channelTitle: "Quelqu'un",
    channelAvatar: null,
    viewCount: 42,
    published: { value: 2, unit: "year" },
  };

  test("reads hours out of the clock a card prints", () => {
    expect(videoFromSearchResult(result).lengthSeconds).toBe(3723);
  });

  /* Required by the client's model, so empty rather than absent. */
  test("gives an author id even when the hit carried none", () => {
    expect(videoFromSearchResult(result).authorId).toBe("");
  });

  test("keeps the phrase YouTube gave instead of a date", () => {
    expect(videoFromSearchResult(result).publishedText).toBe("2 years ago");
    expect(videoFromSearchResult({ ...result, published: { value: 1, unit: "day" } }).publishedText).toBe("1 day ago");
  });

  test("dates the hit from that phrase", () => {
    const now = new Date("2026-08-19T00:00:00Z");
    expect(videoFromSearchResult(result, now).published).toBe(Math.floor(Date.parse("2024-08-19T00:00:00Z") / 1000));
  });

  test("names a channel hit as a channel", () => {
    const channel = channelFromSearchResult({
      channelId: "UCother", title: "Une chaîne", thumbnail: "https://example.test/a.jpg",
      handle: "@x", subscriberCount: "12 k", videoCount: "30",
    });
    expect(channel.type).toBe("channel");
    expect(channel.authorId).toBe("UCother");
  });
});

describe("comments", () => {
  const base = {
    parent: null, authorId: "UCa", authorThumbnail: null, timestamp: 1_700_000_000,
    timeText: "il y a 2 jours", likeCount: 3, isPinned: false, authorIsUploader: false,
  };

  test("returns the top level, and says how many replies each has", () => {
    const mapped = commentsFrom([
      { ...base, id: "c1", text: "Bonjour", author: "A" },
      { ...base, id: "r1", parent: "c1", text: "Salut", author: "B" },
      { ...base, id: "r2", parent: "c1", text: "Re", author: "C" },
      { ...base, id: "c2", text: "Autre", author: "D" },
    ]);
    expect(mapped.comments.map((comment) => comment.commentId)).toEqual(["c1", "c2"]);
    expect(mapped.comments[0].replies?.replyCount).toBe(2);
    expect(mapped.comments[1].replies).toBeUndefined();
  });

  test("treats a root marker as no parent", () => {
    const mapped = commentsFrom([{ ...base, id: "c1", parent: "root", text: "Seul", author: "A" }]);
    expect(mapped.comments).toHaveLength(1);
  });
});

describe("the qualities a document offers", () => {
  test("keeps them as asked while nothing is known yet", () => {
    expect(labelledQualities([720, 360], () => null)).toEqual([
      { asked: 720, label: 720 },
      { asked: 360, label: 360 },
    ]);
  });

  /*
   * A request for 360p on a video with no 360p muxed file comes back with
   * whatever it has — often the same file 720p returns. Offered twice under
   * two labels, one of them is false, and a client picking the smaller
   * downloads the larger believing otherwise.
   */
  test("offers one file once, however many ways it was asked for", () => {
    expect(labelledQualities([720, 360], () => 720)).toEqual([{ asked: 720, label: 720 }]);
  });

  test("says what a quality really turned out to be", () => {
    const known = (asked: number) => (asked === 360 ? 240 : null);
    expect(labelledQualities([720, 360], known)).toEqual([
      { asked: 720, label: 720 },
      { asked: 360, label: 240 },
    ]);
  });

  /* The link still asks for what selects the file; only the label changes. */
  test("keeps the asked-for height, which is what the link carries", () => {
    const [only] = labelledQualities([720, 360], (asked) => (asked === 720 ? 480 : 480));
    expect(only).toEqual({ asked: 720, label: 480 });
  });
});
