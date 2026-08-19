import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runIsolatedTestFile } from "../tests/isolatedTestFile";

const ISOLATION_FLAG = "YTZERO_VIDEO_METADATA_BACKFILL_TEST_ISOLATED";
if (process.env[ISOLATION_FLAG] !== "1") {
  test("video metadata backfill suite runs in an isolated application runtime", async () => {
    await runIsolatedTestFile("src/videoMetadataBackfill.test.ts", ISOLATION_FLAG);
  });
} else {
  const root = mkdtempSync(resolve(tmpdir(), "ytzero-metadata-backfill-"));
  process.env.DB_PATH = resolve(root, "backfill.db");
  const { db } = await import("./db");
  const { database } = await import("./database");
  const { refreshVideoMetadataBatch } = await import("./refresher");
  const { videoInfoRefusalQuiet } = await import("./youtubeRefusalQuiet");

  afterAll(async () => {
    videoInfoRefusalQuiet.clear();
    db.close();
    await database.close();
    rmSync(root, { recursive: true, force: true });
  });

  describe("filling in what a video is missing", () => {
    test("does not charge a video for a lookup nobody made", async () => {
      // While YouTube refuses the address, the lookups are skipped rather than
      // paid for one by one. Counting each skip as a failed attempt would push
      // the video out of the queue for fifteen minutes, then thirty, then an
      // hour — a back-off earned by a question that was never asked.
      db.prepare("INSERT INTO channels(channel_id,title) VALUES('UCbackfill','Backfill')").run();
      for (const id of ["vid0000001", "vid0000002", "vid0000003"]) {
        db.prepare(`INSERT INTO videos(video_id,channel_id,title,published_at,live_status,duration)
          VALUES(?, 'UCbackfill', 'A video', datetime('now'), 'none', NULL)`).run(id);
      }
      // Two of them: one refusal holds nothing now, having been shown to mean
      // nothing — the same lookup succeeds by hand minutes later.
      videoInfoRefusalQuiet.note(new Error("Sign in to confirm you're not a bot"));
      videoInfoRefusalQuiet.note(new Error("Sign in to confirm you're not a bot"));
      expect(videoInfoRefusalQuiet.quiet()).toBe(true);

      // A skip that still reaches for the network is not a skip: the fallback
      // that looks for a publication date on the watch page would put a second
      // question to the very host that has just turned us away.
      const realFetch = globalThis.fetch;
      let reached = 0;
      globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
        reached++;
        return realFetch(...args);
      }) as typeof fetch;
      try {
        const first = await refreshVideoMetadataBatch(3);
        expect(first).toEqual({ checked: 0, skipped: 3, durationsFilled: 0, datesFilled: 0 });
        expect(reached).toBe(0);

        // The refusal still stands, so the next round finds the same three
        // ready to be asked about — not serving a sentence for it.
        const second = await refreshVideoMetadataBatch(3);
        expect(second).toEqual({ checked: 0, skipped: 3, durationsFilled: 0, datesFilled: 0 });
        expect(reached).toBe(0);
      } finally {
        globalThis.fetch = realFetch;
      }
    });
  });
}
