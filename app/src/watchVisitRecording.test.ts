import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runIsolatedTestFile } from "../tests/isolatedTestFile";

const ISOLATION_FLAG = "YTZERO_WATCH_VISIT_TEST_ISOLATED";
if (process.env[ISOLATION_FLAG] !== "1") {
  test("watch-visit suite runs in an isolated application runtime", async () => {
    await runIsolatedTestFile("src/watchVisitRecording.test.ts", ISOLATION_FLAG);
  });
} else {
  const root = mkdtempSync(resolve(tmpdir(), "ytzero-watch-visit-"));
  process.env.DB_PATH = resolve(root, "visits.db");
  const { db } = await import("./db");
  const { api } = await import("./routes");

  db.prepare("INSERT INTO channels(channel_id,title) VALUES('UCvisit','Visited')").run();
  db.prepare(`INSERT INTO videos(video_id,channel_id,title,published_at,duration)
    VALUES('inlibrary01','UCvisit','A video the library has', datetime('now'), 600)`).run();

  const request = (path: string, init?: RequestInit) =>
    api.request(`http://localhost${path}`, {
      ...init,
      headers: { Cookie: "ytzero_profile=1", "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });

  describe("recording that a profile opened a video", () => {
    test("says so when there was nothing to attach the visit to", async () => {
      // A video reached from search has no row until its import finishes. This
      // used to answer a bare ok, so nothing downstream could tell a recorded
      // visit from a dropped one — and the page, believing it done, never asked
      // again once the import had created the row.
      const res = await request("/videos/notimported/watch", { method: "POST", body: "{}" });
      expect(res.status).toBe(200);
      expect((await res.json() as { recorded: boolean }).recorded).toBe(false);
      const rows = db.prepare("SELECT COUNT(*) AS n FROM history WHERE video_id = 'notimported'").get() as { n: number };
      expect(rows.n).toBe(0);
    });

    test("records it, and that is what continue-watching is built from", async () => {
      const res = await request("/videos/inlibrary01/watch", { method: "POST", body: "{}" });
      expect((await res.json() as { recorded: boolean }).recorded).toBe(true);

      // A position on its own is not enough: the shelf joins it to a visit.
      await request("/videos/inlibrary01/progress", {
        method: "PUT",
        body: JSON.stringify({ position: 120, duration: 600 }),
      });
      const shelf = await (await request("/in-progress")).json() as { videos: Array<{ video_id: string }> };
      expect(shelf.videos.map((video) => video.video_id)).toEqual(["inlibrary01"]);
    });

    test("a position with no visit behind it leaves the shelf empty", async () => {
      // Exactly the state a video opened from search was left in: watched,
      // remembered where, and never offered back.
      db.prepare(`INSERT INTO videos(video_id,channel_id,title,published_at,duration)
        VALUES('novisit0001','UCvisit','Watched but never recorded', datetime('now'), 600)`).run();
      await request("/videos/novisit0001/progress", {
        method: "PUT",
        body: JSON.stringify({ position: 120, duration: 600 }),
      });
      const shelf = await (await request("/in-progress")).json() as { videos: Array<{ video_id: string }> };
      expect(shelf.videos.some((video) => video.video_id === "novisit0001")).toBe(false);
    });
  });
}
