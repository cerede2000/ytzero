import { describe, expect, test } from "bun:test";
import { parseCompactCount, parseCompactPublishedText, relatedFromLockup, relatedVideosFromWatchPage, selectRelatedForPanel } from "./relatedVideos";

// Captured from a live watch page. The side panel writes a card differently
// from search: the channel sits in a row with no browse endpoint behind it,
// and the counts and ages are abbreviated.
const lockup = (contentId: string, channel = "Schlantologie", views = "699K", age = "1mo ago") => ({
  contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
  contentId,
  contentImage: {
    thumbnailViewModel: {
      image: { sources: [{ url: "https://i.ytimg.com/small.jpg" }, { url: "https://i.ytimg.com/large.jpg" }] },
      overlays: [{ thumbnailBadgeViewModel: { text: "2:37" } }],
    },
  },
  metadata: {
    lockupMetadataViewModel: {
      title: { content: "AVATAR but in Germany &amp; Austria" },
      image: { decoratedAvatarViewModel: { avatar: { avatarViewModel: { image: { sources: [{ url: "https://yt3/avatar.jpg" }] } } } } },
      metadata: {
        contentMetadataViewModel: {
          metadataRows: [
            { metadataParts: [{ text: { content: channel } }] },
            { metadataParts: [{ text: { content: views } }, { text: { content: age } }] },
            { metadataParts: [] },
          ],
        },
      },
    },
  },
});

const watchPage = (...ids: string[]) => ({
  contents: {
    twoColumnWatchNextResults: {
      secondaryResults: { secondaryResults: { results: ids.map((id) => ({ lockupViewModel: lockup(id) })) } },
    },
  },
});

describe("reading the panel beside the video", () => {
  test("reads a card the search parser cannot", () => {
    // Search finds the channel by the browse endpoint behind its name. The
    // side panel gives no endpoint, so the channel came back empty until the
    // part was identified by what it is rather than by what links from it.
    expect(relatedFromLockup(lockup("xwFjWwBRQmI"))).toEqual({
      videoId: "xwFjWwBRQmI",
      title: "AVATAR but in Germany & Austria",
      thumbnail: "https://i.ytimg.com/large.jpg",
      duration: "2:37",
      channelId: null,
      channelTitle: "Schlantologie",
      channelAvatar: "https://yt3/avatar.jpg",
      viewCount: 699_000,
      published: { value: 1, unit: "month" },
    });
  });

  test("finds the channel wherever in the rows it sits", () => {
    // Named by elimination — neither a count nor an age — so a row order that
    // moves does not silently turn a view count into a channel name.
    const moved = lockup("abc");
    const rows = moved.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows;
    [rows[0], rows[1]] = [rows[1], rows[0]];
    expect(relatedFromLockup(moved)?.channelTitle).toBe("Schlantologie");
  });

  test("ignores anything that is not a video", () => {
    expect(relatedFromLockup({ contentType: "LOCKUP_CONTENT_TYPE_PLAYLIST", contentId: "PL1" })).toBeNull();
    expect(relatedFromLockup({ contentType: "LOCKUP_CONTENT_TYPE_VIDEO" })).toBeNull();
  });

  test("says each video once, however often the page repeats it", () => {
    // A live page listed forty lockups for twenty videos.
    const videos = relatedVideosFromWatchPage(watchPage("a", "b", "a", "b"));
    expect(videos.map((video) => video.videoId)).toEqual(["a", "b"]);
  });

  test("takes suggestions only from the panel they belong to", () => {
    // Lockups appear elsewhere on a watch page — the end screen, for one —
    // and those are not what the viewer is being offered next.
    const elsewhere = { engagementPanels: [{ lockupViewModel: lockup("nope") }] };
    expect(relatedVideosFromWatchPage(elsewhere)).toEqual([]);
    expect(relatedVideosFromWatchPage(null)).toEqual([]);
  });

  test("stops at the limit it was given", () => {
    expect(relatedVideosFromWatchPage(watchPage("a", "b", "c", "d"), 2)).toHaveLength(2);
  });
});

describe("the panel's shorthand", () => {
  test("reads an age written short", () => {
    expect(parseCompactPublishedText("3w ago")).toEqual({ value: 3, unit: "week" });
    expect(parseCompactPublishedText("15y ago")).toEqual({ value: 15, unit: "year" });
    expect(parseCompactPublishedText("2d ago")).toEqual({ value: 2, unit: "day" });
  });

  test("tells months from minutes", () => {
    // "mo" and "m" differ by one letter and by a factor of forty-three
    // thousand; reading them the wrong way round dates a video wildly wrong.
    expect(parseCompactPublishedText("1mo ago")).toEqual({ value: 1, unit: "month" });
    expect(parseCompactPublishedText("1m ago")).toEqual({ value: 1, unit: "minute" });
  });

  test("has nothing to say about what it does not recognise", () => {
    expect(parseCompactPublishedText("1 month ago")).toBeNull();
    expect(parseCompactPublishedText("Streamed live")).toBeNull();
    expect(parseCompactPublishedText(undefined)).toBeNull();
  });

  test("reads a count written short, and refuses what is not one", () => {
    expect(parseCompactCount("699K")).toBe(699_000);
    expect(parseCompactCount("1.6M")).toBe(1_600_000);
    expect(parseCompactCount("539")).toBe(539);
    expect(parseCompactCount("Schlantologie")).toBeNull();
    expect(parseCompactCount("1mo ago")).toBeNull();
  });
});

describe("choosing what the panel carries", () => {
  const video = (videoId: string) => ({ videoId } as never);
  const list = ["a", "b", "c", "d"].map(video);

  test("keeps YouTube's order, which is the recommendation", () => {
    const chosen = selectRelatedForPanel(list, { limit: 3, currentVideoId: "zz" });
    expect(chosen.map((item) => item.videoId)).toEqual(["a", "b", "c"]);
  });

  test("never offers the video being watched", () => {
    const chosen = selectRelatedForPanel(list, { limit: 4, currentVideoId: "b" });
    expect(chosen.map((item) => item.videoId)).toEqual(["a", "c", "d"]);
  });

  test("drops what the library already has, when asked", () => {
    // Those reach the same panel again through its own matching, a few
    // entries further down; showing them twice reads as a bug.
    const options = { limit: 4, currentVideoId: "zz", inLibrary: new Set(["a", "c"]) };
    expect(selectRelatedForPanel(list, { ...options, hideKnown: true }).map((item) => item.videoId)).toEqual(["b", "d"]);
    expect(selectRelatedForPanel(list, options).map((item) => item.videoId)).toEqual(["a", "b", "c", "d"]);
  });

  test("carries nothing when the panel was asked for none", () => {
    // The setting goes down to zero, and zero means the panel stays local.
    expect(selectRelatedForPanel(list, { limit: 0, currentVideoId: "zz" })).toEqual([]);
  });
});
