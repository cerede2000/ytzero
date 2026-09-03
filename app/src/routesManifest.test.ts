import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-routes-manifest-test-"));
let routes: string[] = [];

beforeAll(async () => {
  const child = Bun.spawn([process.execPath, "app/tests/routesManifestHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: {
      ...Bun.env,
      DB_PATH: resolve(root, "db", "source.db"),
      AVATAR_DIR: resolve(root, "avatars"),
      DOWNLOADS_DIR: resolve(root, "downloads"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Routes manifest harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`Routes manifest harness returned no result:\n${stdout}`);
  ({ routes } = JSON.parse(line.slice("RESULT ".length)) as { routes: string[] });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("HTTP route manifest", () => {
  test("keeps every registered method and path stable while routers are extracted", () => {
    const transcriptRoute = "POST /videos/:id/transcript";
    const playbackAdjacentRoute = "POST /playback/adjacent";
    const liveAudioRoute = "GET /videos/:id/audio-live/:resource";
    const vodAudioRoute = "GET /videos/:id/audio/index.m3u8";
    const retryAudioRoute = "POST /videos/:id/audio/retry";
    const directStreamRoute = "GET /videos/:id/direct-stream";
    const ytdlpConfigRoute = "PUT /downloads/ytdlp/config";
    const ytdlpUpdateRoute = "POST /downloads/ytdlp/update";
    const importVideoRoute = "POST /videos/:id/import";
    const sessionPlaylistRoute = "POST /playlists/from-session-queue";
    const clearVideoBookmarksRoute = "DELETE /videos/:id/bookmark";
    const clusterStatusRoute = "GET /cluster/status";
    const notificationPreferenceRoutes = [
      "GET /notification-preferences",
      "PUT /notification-preferences",
      "PUT /notification-preferences/sources/:type/:id",
    ];
    const accessControlRoutes = [
      "GET /access-control", "PUT /access-control/groups/:id", "POST /access-control/groups",
      "PUT /access-control/group-order", "PUT /access-control/default-group", "PUT /access-control/profiles/:id",
      "DELETE /access-control/groups/:id",
    ];
    // Ours, each named so what is left is upstream's own list, unchanged.
    const searchSuggestRoute = "GET /search/suggest";
    const suggestionsRoute = "GET /videos/:id/suggestions";
    // A playlist is a list somebody arranged, so the arrangement is something
    // the page can send back.
    const playlistOrderRoute = "PUT /playlists/:id/order";
    // The seam every search provider is reached through.
    const providerRoutes = ["GET /search/providers", "GET /search/external"];
    // Where a profile mints the token its phone signs in with. The dialect's
    // own routes live on the outer app and never reach this list.
    const invidiousRoutes = routes.filter((route) => route.includes("/invidious/"));
    // An experiment on its own island: routes nothing upstream calls.
    const dailymotionRoutes = routes.filter((route) => route.includes("/dailymotion"));
    const ourRoutes = [searchSuggestRoute, suggestionsRoute, playlistOrderRoute, ...providerRoutes, ...invidiousRoutes, ...dailymotionRoutes];
    expect(routes).toHaveLength(249 + ourRoutes.length);
    for (const route of ourRoutes) expect(routes).toContain(route);
    expect(invidiousRoutes).toEqual([
      "GET /invidious/token",
      "POST /invidious/token",
      "DELETE /invidious/token",
    ]);
    expect(routes).toContain(transcriptRoute);
    expect(routes).toContain(playbackAdjacentRoute);
    expect(routes).toContain(liveAudioRoute);
    expect(routes).toContain(vodAudioRoute);
    expect(routes).toContain(retryAudioRoute);
    expect(routes).toContain(directStreamRoute);
    expect(routes).toContain(ytdlpConfigRoute);
    expect(routes).toContain(ytdlpUpdateRoute);
    expect(routes).toContain(importVideoRoute);
    expect(routes).toContain(sessionPlaylistRoute);
    expect(routes).toContain(clearVideoBookmarksRoute);
    expect(routes).toContain(clusterStatusRoute);
    for (const route of notificationPreferenceRoutes) expect(routes).toContain(route);
    for (const route of accessControlRoutes) expect(routes).toContain(route);
    expect(routes).toContain("GET /plugins/tubearchivist/config");
    expect(routes).toContain("POST /plugins/tubearchivist/sync");
    const legacyRoutes = routes.filter((route) => route !== transcriptRoute && route !== playbackAdjacentRoute && route !== liveAudioRoute && route !== vodAudioRoute && route !== retryAudioRoute && route !== directStreamRoute && route !== ytdlpConfigRoute && route !== ytdlpUpdateRoute && route !== importVideoRoute && route !== sessionPlaylistRoute && route !== clearVideoBookmarksRoute && route !== clusterStatusRoute && !accessControlRoutes.includes(route) && !notificationPreferenceRoutes.includes(route) && !ourRoutes.includes(route));
    expect(createHash("sha256").update(legacyRoutes.join("\n")).digest("hex"))
      .toBe("80c5a76e8b9e73067474352689dee5912762cbd8933feb23ceb68592f592158b");
    // Upstream's own expectation, byte for byte: its routes are untouched.
  });

  test("does not register duplicate method/path pairs", () => {
    expect(new Set(routes).size).toBe(routes.length);
  });
});
