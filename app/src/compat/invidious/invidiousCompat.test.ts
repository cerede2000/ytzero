import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { invidiousStats } from "./stats";
import { invidiousCompatEnabled, registerInvidiousCompat } from "./index";
import { noteRefusal, recentlyRefused } from "./mediaRoutes";

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

describe("a video upstream has just refused", () => {
  /*
   * A player opens several connections and reopens them as each one fails.
   * Unremembered, every one of them pays the full retry ladder and a
   * re-resolution before giving up — a hundred seconds of asking YouTube about
   * a video it refused a moment ago, on an address already being challenged.
   */
  test("is not asked about again straight away", () => {
    const now = 1_800_000_000_000;
    expect(recentlyRefused("abc", now)).toBe(false);
    noteRefusal("abc", now);
    expect(recentlyRefused("abc", now + 1_000)).toBe(true);
  });

  test("is asked about again once the moment has passed", () => {
    const now = 1_800_000_000_000;
    noteRefusal("def", now);
    // Short on purpose: this is a way to fail quickly, not a verdict.
    expect(recentlyRefused("def", now + 31_000)).toBe(false);
  });

  test("says nothing about a video nobody has been refused", () => {
    expect(recentlyRefused("never-asked", 1_800_000_000_000)).toBe(false);
  });
});
