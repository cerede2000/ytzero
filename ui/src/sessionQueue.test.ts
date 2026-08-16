import { describe, expect, test } from "bun:test";
import { parseSessionQueue, readSessionQueue, SESSION_QUEUE_LIMIT, withEntry, withoutEntry } from "./sessionQueue";

import type { SessionQueueEntry } from "./sessionQueue";

const entry = (videoId: string): SessionQueueEntry =>
  ({ videoId, title: `Video ${videoId}`, thumbnail: "t.jpg", channelTitle: "A channel", duration: "3:21" });
const ids = (queue: readonly SessionQueueEntry[]) => queue.map((item) => item.videoId);

describe("gathering a queue while browsing", () => {
  test("keeps the order things were chosen in", () => {
    const queue = [entry("a"), entry("b")].reduce(withEntry, [] as SessionQueueEntry[]);
    expect(ids(withEntry(queue, entry("c")))).toEqual(["a", "b", "c"]);
  });

  test("leaves a video that is already queued where it is", () => {
    // Tapping twice is how you check something went in. It should not answer
    // by moving it to the end of the list you have just built.
    const queue = withEntry(withEntry([], entry("a")), entry("b"));
    expect(ids(withEntry(queue, entry("a")))).toEqual(["a", "b"]);
  });

  test("takes one back out", () => {
    const queue = withEntry(withEntry([], entry("a")), entry("b"));
    expect(ids(withoutEntry(queue, "a"))).toEqual(["b"]);
    expect(ids(withoutEntry(queue, "missing"))).toEqual(["a", "b"]);
  });

  test("stops growing rather than filling storage", () => {
    const full = Array.from({ length: SESSION_QUEUE_LIMIT }, (_, index) => entry(`v${index}`));
    const queue = withEntry(full, entry("last"));
    expect(queue.length).toBe(SESSION_QUEUE_LIMIT);
    expect(queue[queue.length - 1].videoId).toBe("last");
    expect(queue[0].videoId).toBe("v1");
  });
});

describe("reading back what the tab was holding", () => {
  test("hands the same empty queue back every time", () => {
    // A fresh array for an unchanged store is a component that re-renders
    // because of it, reads it again, and never settles.
    expect(readSessionQueue()).toBe(readSessionQueue());
  });

  test("restores a queue written before a reload", () => {
    expect(ids(parseSessionQueue(JSON.stringify([entry("a"), entry("b")])))).toEqual(["a", "b"]);
  });

  test("answers with an empty queue rather than throwing on anything else", () => {
    expect(parseSessionQueue(null)).toEqual([]);
    expect(parseSessionQueue("not json")).toEqual([]);
    expect(parseSessionQueue(JSON.stringify({ videoId: "a" }))).toEqual([]);
  });

  test("drops entries it cannot show", () => {
    const stored = JSON.stringify([entry("a"), { videoId: "b" }, { title: "no id" }, entry("a")]);
    expect(ids(parseSessionQueue(stored))).toEqual(["a"]);
  });
});
