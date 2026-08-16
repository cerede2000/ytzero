import { describe, expect, test } from "bun:test";
import { createVideoImporter } from "./videoImport";
import type { VideoInfo } from "./youtube";

const info = (videoId: string) => ({ videoId, title: "A video", channelId: "UC1" }) as VideoInfo;

function deferred<T>() {
  let settle!: (value: T) => void;
  let fail!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => { settle = resolve; fail = reject; });
  return { promise, settle, fail };
}

describe("importing a video the page is waiting for", () => {
  test("runs one import while two callers want the same video", async () => {
    // A card tapped twice is two navigations to the same page, and the second
    // used to start its own five-second extraction alongside the first.
    const pending = deferred<VideoInfo>();
    let started = 0;
    const importVideo = createVideoImporter(async () => { started++; return pending.promise; });

    const first = importVideo(1, "abc");
    const second = importVideo(1, "abc");
    pending.settle(info("abc"));

    expect(await first).toEqual(await second);
    expect(started).toBe(1);
  });

  test("keeps profiles and videos apart", async () => {
    const started: string[] = [];
    const importVideo = createVideoImporter(async (userId, videoId) => {
      started.push(`${userId}:${videoId}`);
      return info(videoId);
    });

    await Promise.all([importVideo(1, "abc"), importVideo(2, "abc"), importVideo(1, "def")]);

    expect(started.sort()).toEqual(["1:abc", "1:def", "2:abc"]);
  });

  test("holds it only while it runs", async () => {
    // Asking again once the row exists is how the related panel is refilled.
    let started = 0;
    const importVideo = createVideoImporter(async () => { started++; return info("abc"); });

    await importVideo(1, "abc");
    await importVideo(1, "abc");

    expect(started).toBe(2);
  });

  test("does not leave a failure standing in for the next attempt", async () => {
    let started = 0;
    const importVideo = createVideoImporter(async () => {
      started++;
      throw new Error("YouTube said no");
    });

    await expect(importVideo(1, "abc")).rejects.toThrow("YouTube said no");
    await expect(importVideo(1, "abc")).rejects.toThrow("YouTube said no");
    expect(started).toBe(2);
  });
});
