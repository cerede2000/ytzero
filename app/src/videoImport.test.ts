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

  test("answers the ask that lands just after it from what it already knows", async () => {
    // Queueing a video and opening it are two asks a second apart. The second
    // used to arrive just too late for the running import and pay five seconds
    // of yt-dlp for an answer that was already written down.
    let started = 0;
    const importVideo = createVideoImporter(async () => { started++; return info("abc"); });

    const first = await importVideo(1, "abc");
    const second = await importVideo(1, "abc");

    expect(started).toBe(1);
    expect(second).toBe(first);
  });

  test("asks again once the answer is old, so the related panel still refills", async () => {
    let started = 0;
    let clock = 1_000;
    const importVideo = createVideoImporter(async () => { started++; return info("abc"); }, () => clock);

    await importVideo(1, "abc");
    clock += 59_000;
    await importVideo(1, "abc");
    expect(started).toBe(1);

    clock += 2_000;
    await importVideo(1, "abc");
    expect(started).toBe(2);
  });

  test("does not keep an entry for every video it has ever imported", async () => {
    let clock = 1_000;
    const importVideo = createVideoImporter(async (_userId, videoId) => info(videoId), () => clock);

    await importVideo(1, "old");
    clock += 120_000;
    await importVideo(1, "new");

    // The stale entry is gone, so asking about it extracts again rather than
    // answering from a map that only ever grows.
    let started = 0;
    const counting = createVideoImporter(async () => { started++; return info("abc"); }, () => clock);
    await counting(1, "abc");
    clock += 120_000;
    await counting(1, "abc");
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
