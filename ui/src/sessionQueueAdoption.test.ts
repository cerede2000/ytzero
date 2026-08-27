import { describe, expect, test } from "bun:test";
import { adoptedItems, adoptSessionQueue } from "./sessionQueueAdoption";

function fakeStorage(initial: Record<string, string> = {}) {
  const held = new Map(Object.entries(initial));
  return {
    held,
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => { held.set(key, value); },
    removeItem: (key: string) => { held.delete(key); },
  };
}

const OURS = "ytzero.play-queue";
const THEIRS = "ytzero.session-play-queue.v1";
const oldQueue = JSON.stringify([
  { videoId: "abc", title: "Une", thumbnail: "t1", channelTitle: "Chaîne", duration: "9:50" },
  { videoId: "def", title: "Deux", thumbnail: "t2", channelTitle: "Chaîne", duration: null },
]);

describe("a queue left behind by the older implementation", () => {
  test("is carried over, in the shape the menu reads", () => {
    const storage = fakeStorage({ [OURS]: oldQueue });
    expect(adoptSessionQueue(storage)).toBe(2);
    expect(JSON.parse(storage.getItem(THEIRS)!)).toEqual({
      version: 1,
      items: [
        { video_id: "abc", title: "Une", thumbnail: "t1", channel_title: "Chaîne" },
        { video_id: "def", title: "Deux", thumbnail: "t2", channel_title: "Chaîne" },
      ],
    });
  });

  test("is cleared once carried, so it cannot come back later", () => {
    const storage = fakeStorage({ [OURS]: oldQueue });
    adoptSessionQueue(storage);
    expect(storage.getItem(OURS)).toBe(null);
    expect(adoptSessionQueue(storage)).toBe(0);
  });

  test("never overwrites a queue the reader has since built", () => {
    const current = JSON.stringify({ version: 1, items: [{ video_id: "zzz", title: "En cours", thumbnail: "", channel_title: "" }] });
    const storage = fakeStorage({ [OURS]: oldQueue, [THEIRS]: current });
    expect(adoptSessionQueue(storage)).toBe(0);
    expect(storage.getItem(THEIRS)).toBe(current);
    expect(storage.getItem(OURS)).toBe(null);
  });

  test("fills an empty one rather than leaving it empty", () => {
    const storage = fakeStorage({ [OURS]: oldQueue, [THEIRS]: JSON.stringify({ version: 1, items: [] }) });
    expect(adoptSessionQueue(storage)).toBe(2);
  });

  test("keeps nothing it cannot read", () => {
    expect(adoptedItems(null)).toEqual([]);
    expect(adoptedItems("pas du json")).toEqual([]);
    expect(adoptedItems(JSON.stringify({ items: [] }))).toEqual([]);
    expect(adoptedItems(JSON.stringify([{ title: "sans identifiant" }]))).toEqual([]);
    expect(adoptedItems(JSON.stringify([{ videoId: "abc" }, { videoId: "abc" }])).length).toBe(1);
  });

  test("a tab without storage is simply a tab without a queue", () => {
    expect(adoptSessionQueue(null)).toBe(0);
  });
});
