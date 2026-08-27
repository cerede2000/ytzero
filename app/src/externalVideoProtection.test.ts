import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runIsolatedTestFile } from "../tests/isolatedTestFile";

const ISOLATION_FLAG = "YTZERO_EXTERNAL_PROTECTION_TEST_ISOLATED";
if (process.env[ISOLATION_FLAG] !== "1") {
  test("external-video protection suite runs in an isolated application runtime", async () => {
    await runIsolatedTestFile("src/externalVideoProtection.test.ts", ISOLATION_FLAG);
  });
} else {
  const root = mkdtempSync(resolve(tmpdir(), "ytzero-external-"));
  process.env.DB_PATH = resolve(root, "external.db");
  process.env.DOWNLOADS_DIR = resolve(root, "downloads");
  const { db } = await import("./db");
  const { database } = await import("./database");
  const { api } = await import("./routes");

  db.prepare("INSERT INTO channels(channel_id,title,external) VALUES('UCextern','Trouvée en recherche',1)").run();
  for (const id of ["inplaylist1", "queuedvideo", "plainvideo0"]) {
    db.prepare(`INSERT INTO videos(video_id,channel_id,title,published_at,live_status)
      VALUES(?, 'UCextern', 'Une vidéo', datetime('now'), 'none')`).run(id);
  }
  db.prepare("INSERT INTO user_playlists(name,icon,sort_order,user_id,portable_uuid) VALUES('Musique','ListMusic',0,1,'uuid-musique')").run();
  const playlistId = (db.prepare("SELECT id FROM user_playlists WHERE portable_uuid='uuid-musique'").get() as { id: number }).id;
  db.prepare("INSERT INTO user_playlist_videos(playlist_id,video_id,position) VALUES(?,?,0)").run(playlistId, "inplaylist1");
  db.prepare("INSERT INTO user_videos(user_id,video_id,status) VALUES(1,'queuedvideo','queued')").run();

  const remove = (id: string) => api.request(`http://localhost/external/${id}`, { method: "DELETE", headers: { Cookie: "ytzero_profile=1" } });
  const stillThere = async (id: string) => Boolean(await database.prepare("SELECT 1 FROM videos WHERE video_id=?").get(id));

  afterAll(async () => { db.close(); await database.close(); rmSync(root, { recursive: true, force: true }); });

  describe("removing one temporary video", () => {
    test("refuses to take one out of a playlist, and leaves the playlist whole", async () => {
      // The reported loss: a playlist that stayed and emptied itself, because
      // its entries are a foreign key on rows this route deleted.
      const response = await remove("inplaylist1");
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "video is in a playlist", code: "playlist_video_in_use" });
      expect(await stillThere("inplaylist1")).toBe(true);
      const entries = await database.prepare("SELECT count(*) AS n FROM user_playlist_videos WHERE playlist_id=?").get(playlistId) as { n: number };
      expect(entries.n).toBe(1);
    });

    test("refuses one a profile has queued or liked", async () => {
      const response = await remove("queuedvideo");
      expect(response.status).toBe(409);
      expect(await stillThere("queuedvideo")).toBe(true);
    });

    test("still takes one nobody kept", async () => {
      const response = await remove("plainvideo0");
      expect(response.status).toBe(200);
      expect(await stillThere("plainvideo0")).toBe(false);
    });
  });
}
