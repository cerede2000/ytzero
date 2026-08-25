import { describe, expect, test } from "bun:test";
import { audioHlsBufferConfig, shouldFallbackFromHlsJs, shouldFallbackFromNativeHls, shouldStartProgressive } from "./audioMediaSourcePolicy";

describe("audio media source fallback policy", () => {
  test("uses the progressive source only for a missing VOD HLS manifest", () => {
    expect(shouldFallbackFromHlsJs({ hasProgressiveSource: true, live: false, sourceReady: false, status: 404 })).toBe(true);
    expect(shouldFallbackFromHlsJs({ hasProgressiveSource: true, live: false, sourceReady: false, status: 502 })).toBe(false);
    expect(shouldFallbackFromHlsJs({ hasProgressiveSource: true, live: false, sourceReady: true, status: 404 })).toBe(false);
    expect(shouldFallbackFromHlsJs({ hasProgressiveSource: true, live: true, sourceReady: false, status: 404 })).toBe(false);
  });

  test("allows native HLS fallback only before VOD metadata is available", () => {
    expect(shouldFallbackFromNativeHls({ hasProgressiveSource: true, live: false, sourceReady: false })).toBe(true);
    expect(shouldFallbackFromNativeHls({ hasProgressiveSource: true, live: false, sourceReady: true })).toBe(false);
    expect(shouldFallbackFromNativeHls({ hasProgressiveSource: true, live: true, sourceReady: false })).toBe(false);
  });

  test("keeps recordings buffered for four minutes without delaying live audio", () => {
    expect(audioHlsBufferConfig(false)).toEqual({
      backBufferLength: 30,
      lowLatencyMode: false,
      maxBufferLength: 240,
      maxBufferSize: 8 * 1024 * 1024,
      maxMaxBufferLength: 240,
    });
    expect(audioHlsBufferConfig(true)).toEqual({
      backBufferLength: 30,
      lowLatencyMode: true,
      maxBufferLength: 30,
      maxBufferSize: 8 * 1024 * 1024,
      maxMaxBufferLength: 60,
    });
  });
});

describe("where an audio track is read from", () => {
  test("plays a file already on disk as itself", () => {
    // A downloaded video has the track in it. Asking YouTube for one it
    // already has costs a resolution and a network it does not need.
    expect(shouldStartProgressive({ live: false, playlistSrc: "", progressiveSrc: "/api/videos/abc/stream" })).toBe(true);
  });

  test("reads a track coming from YouTube through its playlist", () => {
    expect(shouldStartProgressive({
      live: false,
      playlistSrc: "/api/videos/abc/audio/index.m3u8",
      progressiveSrc: "/api/videos/abc/audio",
    })).toBe(false);
  });

  test("never skips the playlist of a broadcast", () => {
    // A broadcast has no whole file to read: it is a playlist by nature.
    expect(shouldStartProgressive({ live: true, playlistSrc: "", progressiveSrc: "/api/videos/abc/stream" })).toBe(false);
    expect(shouldStartProgressive({ live: false, playlistSrc: "", progressiveSrc: undefined })).toBe(false);
  });
});
