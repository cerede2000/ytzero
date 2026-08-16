import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runIsolatedTestFile } from "../tests/isolatedTestFile";

const ISOLATION_FLAG = "YTZERO_SUBTITLES_WITHOUT_DOWNLOAD_TEST_ISOLATED";
if (process.env[ISOLATION_FLAG] !== "1") {
  test("subtitles-without-download suite runs in an isolated application runtime", async () => {
    await runIsolatedTestFile("src/subtitlesWithoutDownload.test.ts", ISOLATION_FLAG);
  });
} else {
  const root = mkdtempSync(resolve(tmpdir(), "ytzero-subtitles-"));
  const downloads = resolve(root, "downloads");
  mkdirSync(downloads, { recursive: true });
  process.env.DB_PATH = resolve(root, "subtitles.db");
  process.env.DOWNLOADS_DIR = downloads;
  const { db } = await import("./db");
  const { database } = await import("./database");
  const { setProfileDownloadsEnabled } = await import("./downloadSettingsStore");
  const { api } = await import("./routes");

  const videoId = "streamed001";
  db.prepare("INSERT INTO channels(channel_id,title) VALUES('UCstream','Streamed')").run();
  db.prepare(`INSERT INTO videos(video_id,channel_id,title,published_at,live_status)
    VALUES(?, 'UCstream', 'A streamed video', datetime('now'), 'none')`).run(videoId);
  // No download row on purpose: this is a video the direct player streams.
  writeFileSync(resolve(downloads, `${videoId}.en.vtt`), "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nhello\n");
  await setProfileDownloadsEnabled(1, true);

  const request = (path: string, init?: RequestInit) =>
    api.request(`http://localhost${path}`, {
      ...init,
      headers: { Cookie: "ytzero_profile=1", ...(init?.headers ?? {}) },
    });

  afterAll(async () => {
    db.close();
    await database.close();
    rmSync(root, { recursive: true, force: true });
  });

  describe("captions for a video that was never downloaded", () => {
    test("lists the subtitle files that are on disk", async () => {
      const response = await request(`/videos/${videoId}/subtitles`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        subtitles: [{ lang: "en", url: `/api/videos/${videoId}/subtitles/en` }],
      });
    });

    test("serves one", async () => {
      const response = await request(`/videos/${videoId}/subtitles/en`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("WEBVTT");
    });

    test("hands back what is on disk even when the menu asks it to look", async () => {
      // Opening the menu asks the server to find out what this video has. For
      // a video whose subtitles are already here, there is nothing to find.
      const response = await request(`/videos/${videoId}/subtitles?resolve=1`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        subtitles: [{ lang: "en", url: `/api/videos/${videoId}/subtitles/en` }],
      });
    });

    test("accepts a request to fetch another language", async () => {
      // The download requirement used to answer 404 before anything else was
      // read, so asking for captions on a streamed video never got as far as
      // the language. Reaching the language check is how we know it is gone —
      // and an unknown one stops here without troubling yt-dlp.
      const response = await request(`/videos/${videoId}/subtitles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: "not-a-language" }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid language" });
    });
  });
}
