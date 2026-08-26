import { describe, expect, test } from "bun:test";
import { adjacentFromOrder, adjacentFromPlaybackOrder, nextFromOrder, watchlistOrder } from "./playbackAdjacent";
import { LOCALE_TAGS } from "../../shared/uiLanguages";

describe("playback context adjacency", () => {
  test("walks the current source order in either configured direction", () => {
    expect(adjacentFromOrder(["a", "b", "c"], "b", "newest")).toBe("c");
    expect(adjacentFromOrder(["a", "b", "c"], "b", "oldest")).toBe("a");
    expect(adjacentFromOrder(["a", "b", "c"], "missing", "newest")).toBeNull();
  });

  test("walks an explicitly ordered playlist to the following entry", () => {
    expect(nextFromOrder(["a", "b", "c"], "a")).toBe("b");
    expect(nextFromOrder(["a", "b", "c"], "b")).toBe("c");
    expect(nextFromOrder(["a", "b", "c"], "c")).toBeNull();
    expect(nextFromOrder(["a", "b", "c"], "missing")).toBeNull();
  });

  test("ignores feed direction for user and channel playlist orders only", () => {
    for (const kind of ["user-playlist", "channel-playlist", "session"] as const) {
      expect(adjacentFromPlaybackOrder(["a", "b", "c"], "b", kind, "newest")).toBe("c");
      expect(adjacentFromPlaybackOrder(["a", "b", "c"], "b", kind, "oldest")).toBe("c");
    }
    expect(adjacentFromPlaybackOrder(["a", "b", "c"], "b", "history", "oldest")).toBe("a");
    // A queue someone assembled in a tab is a list like the others: it runs
    // to the end rather than stepping backwards into what came before.
    expect(adjacentFromPlaybackOrder(["a", "b", "c"], "b", "session", "oldest")).toBe("c");
    expect(adjacentFromPlaybackOrder(["a", "b", "c"], "b", "session", "newest", "previous")).toBe("a");
    expect(adjacentFromPlaybackOrder(["a", "b", "c"], "c", "session", "newest")).toBeNull();
  });

  test("hands back the entry before when it is asked for by name", () => {
    // A list has an order of its own, so the entry before is asked for by name
    // whichever way the feed preference happens to point.
    for (const kind of ["user-playlist", "channel-playlist", "session"] as const) {
      expect(adjacentFromPlaybackOrder(["a", "b", "c"], "b", kind, "newest", "previous")).toBe("a");
      expect(adjacentFromPlaybackOrder(["a", "b", "c"], "a", kind, "newest", "previous")).toBeNull();
      expect(adjacentFromPlaybackOrder(["a", "b", "c"], "missing", kind, "newest", "previous")).toBeNull();
    }
    // A history is walked by direction alone: going back is the other way, and
    // naming it changes nothing.
    expect(adjacentFromPlaybackOrder(["a", "b", "c"], "b", "history", "oldest")).toBe("a");
    expect(adjacentFromPlaybackOrder(["a", "b", "c"], "b", "history", "newest", "previous")).toBe("c");
  });

  test("recreates the sectioned Watch later order without snapshots", () => {
    const rows = [
      { video_id: "weekend", bucket: "weekend", show_from: "2026-08-15", duration: "1:00", title: "Z", channel_title: "C" },
      { video_id: "tonight", bucket: "tonight", show_from: "2026-08-10 20:00", duration: "3:00", title: "B", channel_title: "B" },
      { video_id: "today", bucket: "today", show_from: "2026-08-10 10:00", duration: "2:00", title: "A", channel_title: "A" },
    ];
    expect(watchlistOrder(rows, "schedule")).toEqual(["today", "tonight", "weekend"]);
    expect(watchlistOrder(rows, "duration-desc")).toEqual(["tonight", "today", "weekend"]);
  });

  test("accepts all shared locale tags for localized title ordering", () => {
    const rows = [
      { video_id: "1", bucket: "today", show_from: null, duration: null, title: "Żaba", channel_title: "Żaba" },
      { video_id: "2", bucket: "today", show_from: null, duration: null, title: "Ala", channel_title: "Ala" },
    ];
    for (const locale of Object.values(LOCALE_TAGS)) {
      expect(watchlistOrder(rows, "title-asc", locale).length).toBe(2);
    }
  });
});
