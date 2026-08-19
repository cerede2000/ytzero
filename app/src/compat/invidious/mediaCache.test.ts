import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = mkdtempSync(join(tmpdir(), "ytzero-invidious-cache-"));
process.env.YTZERO_INVIDIOUS_CACHE_DIR = root;

const { cacheableVideoId, cachedMedia, pruneCache } = await import("./mediaCache");

function file(name: string, bytes: number, usedAt: number) {
  const path = join(root, name);
  writeFileSync(path, new Uint8Array(bytes));
  utimesSync(path, new Date(usedAt), new Date(usedAt));
  return path;
}

describe("the cache a player is served from", () => {
  /* The id becomes a filename, and a filename is a way out of a directory. */
  test("refuses a name that could escape the directory", () => {
    expect(cacheableVideoId("dQw4w9WgXcQ")).toBe(true);
    expect(cacheableVideoId("../../etc/passwd")).toBe(false);
    expect(cacheableVideoId("a/b")).toBe(false);
    expect(cacheableVideoId("")).toBe(false);
    expect(cacheableVideoId("x".repeat(64))).toBe(false);
  });

  test("says nothing is kept when nothing is", () => {
    expect(cachedMedia("absent00001")).toBeNull();
  });

  test("evicts the least recently served until it is back under the cap", () => {
    const old = file("oldest00001.mp4", 400, Date.now() - 60_000);
    const middle = file("middle00001.mp4", 400, Date.now() - 30_000);
    const recent = file("recent00001.mp4", 400, Date.now());

    pruneCache(900);

    const left = readdirSync(root).filter((name) => name.endsWith(".mp4")).sort();
    expect(left).toEqual(["middle00001.mp4", "recent00001.mp4"]);
    expect(old).toContain("oldest");
    expect(middle).toContain("middle");
    expect(recent).toContain("recent");
  });

  test("keeps the one just fetched even when it is the biggest", () => {
    for (const name of readdirSync(root)) rmSync(join(root, name), { force: true });
    file("small000001.mp4", 100, Date.now() - 60_000);
    const fresh = file("fresh000001.mp4", 900, Date.now());

    pruneCache(200, fresh);

    expect(readdirSync(root)).toContain("fresh000001.mp4");
  });

  test("leaves a cache that fits alone", () => {
    for (const name of readdirSync(root)) rmSync(join(root, name), { force: true });
    file("kept0000001.mp4", 100, Date.now());
    pruneCache(1_000);
    expect(readdirSync(root)).toHaveLength(1);
  });
});
