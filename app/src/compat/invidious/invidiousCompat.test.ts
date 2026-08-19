import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { invidiousStats } from "./stats";
import { invidiousCompatEnabled, registerInvidiousCompat } from "./index";
import { directGrace, directResponse, firstServed, noteDirectOutcome, noteRefusal, recentlyRefused } from "./mediaRoutes";

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

describe("several connections asking for one video at once", () => {
  const signal = new AbortController().signal;

  /*
   * A native player opens several at once. Each was starting its own
   * extraction and its own retry ladder against the same address — twenty
   * seconds of 403 in parallel before any of them had a verdict to share.
   */
  test("only one of them finds out that the direct path is refused", async () => {
    let asked = 0;
    const refuse = async () => { asked += 1; await Bun.sleep(5); return null; };
    const answers = await Promise.all([
      directResponse(1, "refused0001", "bytes=0-", signal, refuse),
      directResponse(1, "refused0001", "bytes=0-", signal, refuse),
      directResponse(1, "refused0001", "bytes=0-", signal, refuse),
    ]);
    expect(answers).toEqual([null, null, null]);
    expect(asked).toBe(1);
  });

  /* When it serves, the others ask too — and find the source already resolved. */
  test("all of them are served when it works", async () => {
    let asked = 0;
    const serve = async () => { asked += 1; await Bun.sleep(5); return new Response("x"); };
    const answers = await Promise.all([
      directResponse(1, "served00001", "bytes=0-", signal, serve),
      directResponse(1, "served00001", "bytes=0-", signal, serve),
    ]);
    expect(answers.every((answer) => answer !== null)).toBe(true);
    expect(asked).toBe(2);
  });

  test("asks again once the first verdict is spent", async () => {
    let asked = 0;
    const refuse = async () => { asked += 1; return null; };
    await directResponse(1, "later000001", "bytes=0-", signal, refuse);
    await directResponse(1, "later000001", "bytes=0-", signal, refuse);
    expect(asked).toBe(2);
  });
});

describe("two ways of serving one video, racing", () => {
  const answers = (status: number, after: number) =>
    Bun.sleep(after).then(() => new Response("x", { status }));

  test("serves whichever is ready first", async () => {
    const slow = answers(206, 40);
    const quick = answers(200, 5);
    const served = await firstServed([slow, quick]);
    expect(served?.status).toBe(200);
  });

  /* A path that cannot serve must not decide the race for the one that can. */
  test("waits for the other when the first has nothing", async () => {
    const nothing = Bun.sleep(5).then(() => null);
    const served = await firstServed([nothing, answers(206, 30)]);
    expect(served?.status).toBe(206);
  });

  test("says nothing only when neither could", async () => {
    expect(await firstServed([Bun.sleep(1).then(() => null), Bun.sleep(2).then(() => null)])).toBeNull();
  });

  /* The loser's body is a connection nobody will read: drain it. */
  test("drains the answer that arrived too late", async () => {
    const late = answers(206, 30);
    await firstServed([late, answers(200, 5)]);
    await Bun.sleep(50);
    expect((await late).bodyUsed).toBe(true);
  });

  test("survives a path that throws", async () => {
    const served = await firstServed([Promise.reject(new Error("refused")), answers(206, 5)]);
    expect(served?.status).toBe(206);
  });
});

describe("betting on the direct path", () => {
  test("waits for it while it is still working", () => {
    noteDirectOutcome(true);
    expect(directGrace()).toBeGreaterThan(0);
  });

  /*
   * The grace is a bet that the address will serve. On an instance where it
   * never does, it is paid on every video — and paid twice over, because the
   * fetch behind it then starts its own extraction with the player already
   * waiting.
   */
  test("stops waiting after it has been refused twice running", () => {
    noteDirectOutcome(true);
    noteDirectOutcome(false);
    expect(directGrace()).toBeGreaterThan(0);
    noteDirectOutcome(false);
    expect(directGrace()).toBe(0);
  });

  test("starts waiting again the moment it works", () => {
    noteDirectOutcome(false);
    noteDirectOutcome(false);
    expect(directGrace()).toBe(0);
    noteDirectOutcome(true);
    expect(directGrace()).toBeGreaterThan(0);
  });
});
