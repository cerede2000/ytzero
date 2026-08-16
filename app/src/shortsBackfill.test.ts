import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runIsolatedTestFile } from "../tests/isolatedTestFile";

const ISOLATION_FLAG = "YTZERO_SHORTS_BACKFILL_TEST_ISOLATED";
if (process.env[ISOLATION_FLAG] !== "1") {
  test("shorts backfill suite runs in an isolated application runtime", async () => {
    await runIsolatedTestFile("src/shortsBackfill.test.ts", ISOLATION_FLAG);
  });
} else {
  const root = mkdtempSync(resolve(tmpdir(), "ytzero-shorts-"));
  process.env.DB_PATH = resolve(root, "shorts.db");
  const { db } = await import("./db");
  const { database } = await import("./database");
  const { backfillShorts, shortCheckBackoffMs } = await import("./refresher");

  db.prepare("INSERT INTO channels(channel_id,title) VALUES('UCshorts','Shorts')").run();
  for (const id of ["unknown0001", "settled0001"]) {
    db.prepare(`INSERT INTO videos(video_id,channel_id,title,published_at,live_status)
      VALUES(?, 'UCshorts', 'A video', datetime('now'), 'none')`).run(id);
  }

  afterAll(async () => {
    db.close();
    await database.close();
    rmSync(root, { recursive: true, force: true });
  });

  describe("working out which videos are shorts", () => {
    test("stops asking about one YouTube will not settle", async () => {
      // An unknown stays unknown on purpose — writing "not a short" on a guess
      // would let an automatic job act on it. But the row was left exactly as
      // it was, so the same video came back every refresh, for ever.
      const asked: string[] = [];
      const classify = async (videoId: string) => {
        asked.push(videoId);
        return videoId === "settled0001" ? true : null;
      };

      const first = await backfillShorts(undefined, 10, classify);
      expect(first).toEqual({ checked: 2, resolved: 1, postponed: 1 });
      expect(asked.sort()).toEqual(["settled0001", "unknown0001"]);

      // The settled one is written and gone from the queue; the unsettled one
      // is left alone rather than asked about again a minute later.
      const second = await backfillShorts(undefined, 10, classify);
      expect(second).toEqual({ checked: 0, resolved: 0, postponed: 0 });
      expect(asked).toHaveLength(2);
    });

    test("a refusal ends the pass rather than costing every video a day", async () => {
      // classifyIsShort answers null without asking anything while the address
      // is being refused, and the caller counted that as a check YouTube had
      // declined — backing the video off for up to a day over a question that
      // was never put, for every video left in the batch.
      db.prepare(`INSERT INTO videos(video_id,channel_id,title,published_at,live_status)
        VALUES('refused0001', 'UCshorts', 'A video', datetime('now'), 'none')`).run();
      const asked: string[] = [];
      const classify = async (videoId: string) => { asked.push(videoId); return null; };

      const refused = await backfillShorts(undefined, 10, classify, () => true);
      expect(refused).toEqual({ checked: 0, resolved: 0, postponed: 0 });
      expect(asked).toEqual([]);

      // And it is still due once the refusal lifts, rather than held back for
      // half an hour by a check that never happened.
      await backfillShorts(undefined, 10, classify, () => false);
      expect(asked).toEqual(["refused0001"]);
    });

    test("waits longer each time, and not for ever", () => {
      expect(shortCheckBackoffMs(1)).toBe(30 * 60_000);
      expect(shortCheckBackoffMs(2)).toBe(60 * 60_000);
      expect(shortCheckBackoffMs(3)).toBe(2 * 60 * 60_000);
      expect(shortCheckBackoffMs(99)).toBe(24 * 60 * 60_000);
    });
  });
}
