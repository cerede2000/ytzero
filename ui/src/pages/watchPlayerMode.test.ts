import { describe, expect, test } from "bun:test";
import { resolvePlayerKind, shouldLatchCompletedDownload } from "./watchPlayerMode";

const base = {
  hasVideo: true,
  isLive: false,
  downloadStatus: null,
  playerSource: "auto" as const,
  playbackPolicyReady: true,
  childDownloadsOnly: false,
  sourceChoice: "undecided" as const,
  watchMode: "youtube" as const,
  streamingEnabled: false,
  keepStreamingAfterDownload: false,
};

describe("resolvePlayerKind", () => {
  test("does not mount YouTube before the download policy is loaded", () => {
    expect(resolvePlayerKind({ ...base, playbackPolicyReady: false })).toBe("loading");
  });

  test("holds the player back while the row it is about is still coming", () => {
    expect(resolvePlayerKind({ ...base, hasVideo: false, playerPending: true })).toBe("loading");
    expect(resolvePlayerKind({ ...base, hasVideo: false, playerPending: false })).toBe("youtube");
    expect(resolvePlayerKind({ ...base, playerPending: false })).toBe("youtube");
  });

  test("shows the source choice when ask mode is ready", () => {
    expect(resolvePlayerKind({ ...base, watchMode: "ask" })).toBe("choice");
  });

  test("honors each choice made in ask mode", () => {
    expect(resolvePlayerKind({ ...base, watchMode: "ask", sourceChoice: "youtube" })).toBe("youtube");
    expect(resolvePlayerKind({ ...base, watchMode: "ask", sourceChoice: "wait" })).toBe("waiting");
  });

  test("plays an existing local file without waiting for policy requests", () => {
    expect(resolvePlayerKind({ ...base, downloadStatus: "done", playbackPolicyReady: false })).toBe("local");
  });

  test("always uses YouTube for a live or upcoming stream", () => {
    expect(resolvePlayerKind({ ...base, isLive: true, downloadStatus: "done", watchMode: "download" })).toBe("youtube");
  });

  test("plays TubeArchivist media as a local source, including downloads-only profiles", () => {
    expect(resolvePlayerKind({ ...base, localMediaSource: "tubearchivist" })).toBe("local");
    expect(resolvePlayerKind({ ...base, localMediaSource: "tubearchivist", childDownloadsOnly: true })).toBe("local");
    expect(resolvePlayerKind({ ...base, localMediaSource: "tubearchivist", playerSource: "youtube" })).toBe("youtube");
  });

  describe("experimental streaming", () => {
    test("defaults to the YouTube embed even when streaming is enabled", () => {
      // Embed-first is the default; streaming only exists as a fallback here.
      expect(resolvePlayerKind({ ...base, streamingEnabled: true })).toBe("youtube");
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, watchMode: "download" })).toBe("youtube");
    });

    test("does not let a stale library row own the streaming player", () => {
      expect(resolvePlayerKind({ ...base, hasVideo: false, streamingEnabled: true })).toBe("youtube");
    });

    test("prefers streaming over the wait/ask panels", () => {
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, defaultSource: "stream", watchMode: "download" })).toBe("stream");
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, defaultSource: "stream", watchMode: "ask" })).toBe("stream");
    });

    test("drops to the direct stream when the embed can't play", () => {
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, iframeFallback: true })).toBe("stream");
      // ...but not when streaming is off — the embed error just stands.
      expect(resolvePlayerKind({ ...base, streamingEnabled: false, iframeFallback: true })).toBe("youtube");
    });

    test("waits rather than leaving a refused embed on screen", () => {
      // A video opened from a search is imported before it can be streamed,
      // and an embed that has already said "unavailable" would sit there for
      // the whole import saying something untrue: it is on its way.
      const importing = { ...base, hasVideo: false, streamingEnabled: true, iframeFallback: true };
      expect(resolvePlayerKind(importing)).toBe("loading");
      // Only once the embed has actually refused: an ordinary import shows the
      // embed straight away, because most videos play in it.
      expect(resolvePlayerKind({ ...importing, iframeFallback: false })).toBe("youtube");
      // And only where a stream would take over. With nothing to fall back to,
      // the embed's own message is the honest answer.
      expect(resolvePlayerKind({ ...importing, streamingEnabled: false })).toBe("youtube");
      expect(resolvePlayerKind({ ...importing, playerSource: "youtube" })).toBe("youtube");
      expect(resolvePlayerKind({ ...importing, sourceChoice: "youtube" })).toBe("youtube");
    });

    test("streams first when the default source is the direct stream", () => {
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, defaultSource: "stream" })).toBe("stream");
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, defaultSource: "stream", watchMode: "download" })).toBe("stream");
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, defaultSource: "stream", downloadStatus: "downloading" })).toBe("stream");
    });

    test("still plays a finished local file instead of re-streaming", () => {
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, defaultSource: "stream", downloadStatus: "done" })).toBe("local");
    });

    test("routes a no-muxed video to the download-wait panel in either mode", () => {
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, sourceChoice: "wait" })).toBe("waiting");
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, defaultSource: "stream", sourceChoice: "wait" })).toBe("waiting");
    });

    test("plays a live broadcast natively when streaming is on", () => {
      // A running live streams via its native HLS (so it can go PiP / background).
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, isLive: true })).toBe("stream");
      // An upcoming (not-yet-started) stream has nothing to play → keep the iframe.
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, isLive: true, isUpcoming: true })).toBe("youtube");
      // Without streaming enabled, a live still falls back to the iframe.
      expect(resolvePlayerKind({ ...base, streamingEnabled: false, isLive: true })).toBe("youtube");
    });

    test("lets the viewer fall back to YouTube from the direct stream", () => {
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, defaultSource: "stream", playerSource: "youtube" })).toBe("youtube");
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, defaultSource: "stream", sourceChoice: "youtube" })).toBe("youtube");
    });

    test("does not stream for a downloads-only child profile", () => {
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, defaultSource: "stream", childDownloadsOnly: true })).toBe("blocked");
    });

    test("hands off to the local player once the background download finishes", () => {
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, defaultSource: "stream", downloadStatus: "done" })).toBe("local");
    });

    test("keeps an active stream mounted until the viewer accepts the finished local file", () => {
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, downloadStatus: "done", keepStreamingAfterDownload: true })).toBe("stream");
      expect(resolvePlayerKind({ ...base, streamingEnabled: true, downloadStatus: "done", keepStreamingAfterDownload: true, playerSource: "youtube" })).toBe("youtube");
    });
  });

});

describe("shouldLatchCompletedDownload", () => {
  test("latches every completion observed by an active stream", () => {
    expect(shouldLatchCompletedDownload("stream", null, "done")).toBe(true);
    expect(shouldLatchCompletedDownload("stream", "error", "done")).toBe(true);
    expect(shouldLatchCompletedDownload("stream", "downloading", "done")).toBe(true);
  });

  test("only announces a YouTube background download that was already in progress", () => {
    expect(shouldLatchCompletedDownload("youtube", "downloading", "done")).toBe(true);
    expect(shouldLatchCompletedDownload("youtube", null, "done")).toBe(false);
    expect(shouldLatchCompletedDownload("local", "downloading", "done")).toBe(false);
    expect(shouldLatchCompletedDownload("stream", "downloading", "error")).toBe(false);
  });
});
