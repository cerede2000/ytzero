import { describe, expect, test } from "bun:test";
import { parsePlaybackContext, type PlaybackContext, SESSION_PLAY_QUEUE_MAX_ITEMS } from "./playbackContext";
import { persistsPlaybackContext } from "./routes/playbackRoutes";

describe("persisted playback context", () => {
  test("normalizes every supported source", () => {
    const contexts = [
      { version: 1, kind: "feed", tags: [2, 2, 5], sort: "published", showAll: true },
      { version: 1, kind: "liked", showShorts: false },
      { version: 1, kind: "history" },
      { version: 1, kind: "archive" },
      { version: 1, kind: "user-playlist", playlistUuid: "123e4567-e89b-42d3-a456-426614174000", sort: "added-oldest" },
      { version: 1, kind: "channel-playlist", playlistId: "PL1234567890", sort: "playlist-order" },
      { version: 1, kind: "watchlist", sort: "channel-asc", dueOnly: true },
      { version: 1, kind: "recommendations" },
      { version: 1, kind: "in-progress" },
      { version: 1, kind: "session", ids: ["dQw4w9WgXcQ", "dQw4w9WgXcQ", "abcdefghijk"] },
    ] satisfies PlaybackContext[];
    for (const input of contexts) {
      const parsed = parsePlaybackContext(input);
      expect(parsed).not.toBeNull();
    }
    expect(parsePlaybackContext(contexts[0])).toEqual({ version: 1, kind: "feed", tags: [2, 5], sort: "published", showAll: true });
    expect(parsePlaybackContext({ version: 1, kind: "user-playlist", playlistUuid: "123e4567-e89b-42d3-a456-426614174000" }))
      .toEqual({ version: 1, kind: "user-playlist", playlistUuid: "123e4567-e89b-42d3-a456-426614174000", sort: "added-newest" });
    expect(parsePlaybackContext({ version: 1, kind: "session", ids: ["dQw4w9WgXcQ", "dQw4w9WgXcQ"] })).toEqual({ version: 1, kind: "session", ids: ["dQw4w9WgXcQ"] });
  });

  test("carries the order of a queue that exists nowhere else", () => {
    // Every other kind names a list this server can look up. A session queue
    // was gathered in one browser tab, so its order arrives with it — the one
    // context that does hold video ids, and for the only reason that justifies
    // it.
    expect(parsePlaybackContext({ version: 1, kind: "session", ids: ["dQw4w9WgXcQ", "sF80I-TQiW0"] }))
      .toEqual({ version: 1, kind: "session", ids: ["dQw4w9WgXcQ", "sF80I-TQiW0"] });
  });

  test("takes a session queue as an order, not as text to hand to a query", () => {
    expect(parsePlaybackContext({ version: 1, kind: "session", ids: ["dQw4w9WgXcQ", "dQw4w9WgXcQ"] }))
      .toEqual({ version: 1, kind: "session", ids: ["dQw4w9WgXcQ"] });
    expect(parsePlaybackContext({ version: 1, kind: "session", ids: ["' OR 1=1 --", 42, null] })).toBeNull();
    // An empty queue parses: it is a list that happens to name nothing, and
    // the adjacency it is asked for simply has no answer.
    expect(parsePlaybackContext({ version: 1, kind: "session", ids: [] }))
      .toEqual({ version: 1, kind: "session", ids: [] });
    expect(parsePlaybackContext({ version: 1, kind: "session" })).toBeNull();
    // The cap is a refusal, not a truncation: a list longer than a browser can
    // build did not come from one, and playing its first hundred entries would
    // be answering something nobody asked for.
    const ids = (count: number) => Array.from({ length: count }, (_, index) => `v${String(index).padStart(10, "0")}`);
    expect(parsePlaybackContext({ version: 1, kind: "session", ids: ids(SESSION_PLAY_QUEUE_MAX_ITEMS) }))
      .toMatchObject({ kind: "session" });
    expect(parsePlaybackContext({ version: 1, kind: "session", ids: ids(SESSION_PLAY_QUEUE_MAX_ITEMS + 1) })).toBeNull();
  });

  test("rejects unversioned, oversized and snapshot contexts", () => {
    expect(parsePlaybackContext({ kind: "history" })).toBeNull();
    expect(parsePlaybackContext({ version: 1, kind: "snapshot", videoIds: ["video"] })).toBeNull();
    expect(parsePlaybackContext({ version: 1, kind: "feed", tags: Array.from({ length: 51 }, (_, index) => index + 1), showAll: false, sort: "published" })).toBeNull();
    expect(parsePlaybackContext({ version: 1, kind: "session", ids: Array.from({ length: 101 }, () => "dQw4w9WgXcQ") })).toBeNull();
  });

  test("does not persist a session-only context on a video", () => {
    expect(persistsPlaybackContext(parsePlaybackContext({ version: 1, kind: "session", ids: ["dQw4w9WgXcQ"] }))).toBe(false);
    expect(persistsPlaybackContext(parsePlaybackContext({ version: 1, kind: "history" }))).toBe(true);
  });
});
