import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { invidiousStats } from "./stats";
import { invidiousCompatEnabled, registerInvidiousCompat } from "./index";

const original = process.env.YTZERO_INVIDIOUS_COMPAT;
afterEach(() => {
  if (original === undefined) delete process.env.YTZERO_INVIDIOUS_COMPAT;
  else process.env.YTZERO_INVIDIOUS_COMPAT = original;
});

/** An app shaped like ours: the compat routes first, then the session-guarded API. */
function serverWithSessionGuard(): Hono {
  const app = new Hono();
  registerInvidiousCompat(app);
  const api = new Hono();
  api.use("*", async (c) => c.json({ error: "unauthorised" }, 401));
  app.route("/api", api);
  return app;
}

describe("Invidious detection", () => {
  test("says the one thing a client reads to identify the software", () => {
    // Yattee's InstanceDetector concludes "Invidious" on this field alone;
    // anything else there and the probe falls through to Piped and fails.
    expect(invidiousStats().software.name).toBe("invidious");
  });

  test("carries the rest of the document clients decode", () => {
    const stats = invidiousStats(1_700_000_000_000);
    expect(stats.version).toBe("2.0");
    expect(stats.software.version).toBeString();
    expect(stats.openRegistrations).toBe(false);
    expect(stats.usage.users.total).toBe(0);
    expect(stats.metadata.updatedAt).toBe(1_700_000_000);
  });

  test("does not exist unless the instance asked for it", async () => {
    delete process.env.YTZERO_INVIDIOUS_COMPAT;
    expect(invidiousCompatEnabled()).toBe(false);
    const app = new Hono();
    registerInvidiousCompat(app);
    expect((await app.request("/api/v1/stats")).status).toBe(404);
  });

  /*
   * The property the whole feature rests on: a route declared before the API
   * router answers without the session middleware that router installs. It is
   * how /api/health already works, and detection has to happen before a client
   * has any session at all — if this ever stopped holding, every client would
   * see 401 and conclude "not an Invidious server".
   */
  test("answers ahead of the session guard", async () => {
    process.env.YTZERO_INVIDIOUS_COMPAT = "1";
    const response = await serverWithSessionGuard().request("/api/v1/stats");
    expect(response.status).toBe(200);
    expect((await response.json() as { software: { name: string } }).software.name).toBe("invidious");
  });

  test("leaves the rest of the API behind its guard", async () => {
    process.env.YTZERO_INVIDIOUS_COMPAT = "1";
    expect((await serverWithSessionGuard().request("/api/feed")).status).toBe(401);
  });
});

describe("an instance that asks clients who they are", () => {
  /*
   * The catalogue is somebody's library, and a client sends credentials on
   * every request — so it is answered for whoever they belong to, and refused
   * when there are none. Each of these is one route: a new one that forgot to
   * ask would answer 200 here.
   */
  const catalogue = [
    "/api/v1/stats",
    "/api/v1/search?q=x",
    "/api/v1/search/suggestions?q=x",
    "/api/v1/videos/dQw4w9WgXcQ",
    "/api/v1/comments/dQw4w9WgXcQ",
    "/api/v1/channels/UCabc",
    "/api/v1/channels/UCabc/videos",
    "/api/v1/channels/UCabc/shorts",
    "/api/v1/channels/UCabc/streams",
    "/api/v1/channels/UCabc/playlists",
    "/api/v1/playlists/PLabc",
    "/api/v1/trending",
    "/api/v1/popular",
  ];

  test("refuses every list to a request that says nothing", async () => {
    process.env.YTZERO_INVIDIOUS_COMPAT = "1";
    process.env.YTZERO_INVIDIOUS_COMPAT_AUTH = "basic";
    const app = new Hono();
    registerInvidiousCompat(app);
    for (const path of catalogue) {
      expect(`${path} -> ${(await app.request(path)).status}`).toBe(`${path} -> 401`);
    }
    delete process.env.YTZERO_INVIDIOUS_COMPAT_AUTH;
  });

  test("says what it wants, in the header a client reads", async () => {
    process.env.YTZERO_INVIDIOUS_COMPAT = "1";
    process.env.YTZERO_INVIDIOUS_COMPAT_AUTH = "basic";
    const app = new Hono();
    registerInvidiousCompat(app);
    const response = await app.request("/api/v1/stats");
    expect(response.headers.get("WWW-Authenticate")).toStartWith("Basic realm=");
    delete process.env.YTZERO_INVIDIOUS_COMPAT_AUTH;
  });

  /*
   * The mistake this exists to prevent. A player carries no credentials, so a
   * challenge on a media route does not ask it for any — it ends the video.
   * These prove their own case with the signature they were handed.
   */
  test("never challenges the routes a player follows", async () => {
    process.env.YTZERO_INVIDIOUS_COMPAT = "1";
    process.env.YTZERO_INVIDIOUS_COMPAT_AUTH = "basic";
    const app = new Hono();
    registerInvidiousCompat(app);
    for (const path of ["/api/v1/media/dQw4w9WgXcQ", "/api/v1/captions/dQw4w9WgXcQ?lang=en", "/api/v1/dm/x7tgad0/hls.m3u8"]) {
      expect(`${path} -> ${(await app.request(path)).status}`).toBe(`${path} -> 403`);
    }
    delete process.env.YTZERO_INVIDIOUS_COMPAT_AUTH;
  });
});
