import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = mkdtempSync(join(tmpdir(), "ytzero-invidious-cache-"));
process.env.YTZERO_INVIDIOUS_CACHE_DIR = root;

const { cacheableVideoId, cachedMedia, partialFileResponse, pruneCache, wantedRange } = await import("./mediaCache");

// Each test owns the directory: the order they run in is not fixed, and one
// leaving files behind decided what the next one measured.
beforeEach(() => {
  for (const name of readdirSync(root)) rmSync(join(root, name), { force: true });
});

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
    file("small000001.mp4", 100, Date.now() - 60_000);
    const fresh = file("fresh000001.mp4", 900, Date.now());

    pruneCache(200, fresh);

    expect(readdirSync(root)).toContain("fresh000001.mp4");
  });

  test("leaves a cache that fits alone", () => {
    file("kept0000001.mp4", 100, Date.now());
    pruneCache(1_000);
    expect(readdirSync(root)).toHaveLength(1);
  });
});

describe("a range asked for while the file is still arriving", () => {
  const total = 10_000;

  test("is the front of the file when a player asks for everything", () => {
    // A player that sends `bytes=0-` wants the file; answering it in full
    // would mean holding a film in memory to put a length on it.
    expect(wantedRange("bytes=0-", total)).toEqual({ start: 0, end: 9_999 });
  });

  test("is bounded by what was asked for", () => {
    expect(wantedRange("bytes=100-199", total)).toEqual({ start: 100, end: 199 });
  });

  test("never runs past the end of the finished file", () => {
    expect(wantedRange("bytes=9990-99999", total)).toEqual({ start: 9_990, end: 9_999 });
  });

  test("is the whole front when no range was asked for at all", () => {
    expect(wantedRange(undefined, total)).toEqual({ start: 0, end: 9_999 });
  });

  /* Past the end is not a range to wait for; it is a request to refuse. */
  test("is nothing when it starts past the end", () => {
    expect(wantedRange("bytes=10000-", total)).toBeNull();
    expect(wantedRange("bytes=99999-", total)).toBeNull();
  });

  test("is capped so one answer cannot be a whole film", () => {
    const huge = 200 * 1024 * 1024;
    const asked = wantedRange("bytes=0-", huge)!;
    expect(asked.end - asked.start + 1).toBe(8 * 1024 * 1024);
  });
});

describe("answering while the file is still arriving", () => {
  /*
   * A player opens with `bytes=0-`, meaning the whole file. Waiting for all of
   * it is the whole point of serving early thrown away — measured on a live
   * instance, the first bytes went out at the same instant the download
   * finished, twenty-four seconds after it began.
   */
  test("sends what has arrived instead of waiting for what was asked", async () => {
    const path = join(root, "growing.partial");
    writeFileSync(path, new Uint8Array(300 * 1024));
    const entry = { path, total: Promise.resolve(4_000_000), done: new Promise<string | null>(() => {}) };

    const answered = await Promise.race([
      partialFileResponse(entry, "bytes=0-"),
      Bun.sleep(1_000).then(() => "waited" as const),
    ]);

    expect(answered).not.toBe("waited");
    const response = answered as Response;
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 0-${300 * 1024 - 1}/4000000`);
  });

  test("refuses a range that starts past the end", async () => {
    const path = join(root, "short.partial");
    writeFileSync(path, new Uint8Array(1_000));
    const entry = { path, total: Promise.resolve(1_000), done: Promise.resolve(path) };
    const response = await partialFileResponse(entry, "bytes=5000-");
    expect(response?.status).toBe(416);
  });

  /* Without a length there is nothing to answer a range against. */
  test("says nothing when the size was never announced", async () => {
    const path = join(root, "sizeless.partial");
    writeFileSync(path, new Uint8Array(1_000));
    const entry = { path, total: Promise.resolve(null), done: Promise.resolve(path) };
    expect(await partialFileResponse(entry, "bytes=0-")).toBeNull();
  });
});
