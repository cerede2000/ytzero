import { describe, expect, test } from "bun:test";
import { cookieHealth, currentCookieHealth, forgetCookieHealth, recordCookieRecognition } from "./youtubeCookieHealth";

describe("whether YouTube still knows the account behind a jar", () => {
  test("asks when nobody has lately, rather than waiting to be told", async () => {
    // The panel is fetched anonymously unless the reader asked otherwise, so
    // nothing else necessarily makes a signed-in request. A state that only
    // recorded what happened to pass by stays unknown for ever, which is the
    // same as not having it — and is exactly why no badge appeared.
    let asks = 0;
    const health = await currentCookieHealth(
      401,
      () => 1_000,
      async () => { asks++; return { signedIn: true, setCookies: [] }; },
      () => "SID=abc",
    );
    expect(asks).toBe(1);
    expect(health?.recognised).toBe(true);
  });

  test("a fresh answer is not asked for again", async () => {
    let asks = 0;
    const ask = async () => { asks++; return { signedIn: false, setCookies: [] as string[] }; };
    await currentCookieHealth(402, () => 1_000, ask, () => "SID=abc");
    await currentCookieHealth(402, () => 2_000, ask, () => "SID=abc");
    expect(asks).toBe(1);
    expect(cookieHealth(402)?.recognised).toBe(false);
  });

  test("asks again once the answer is old", async () => {
    let asks = 0;
    const ask = async () => { asks++; return { signedIn: true, setCookies: [] as string[] }; };
    await currentCookieHealth(403, () => 1_000, ask, () => "SID=abc");
    await currentCookieHealth(403, () => 1_000 + 11 * 60_000, ask, () => "SID=abc");
    expect(asks).toBe(2);
  });

  test("a question that could not be put leaves what was known standing", async () => {
    recordCookieRecognition(404, true, () => 1_000);
    const health = await currentCookieHealth(
      404,
      () => 1_000 + 11 * 60_000,
      async () => { throw new Error("the network was down"); },
      () => "SID=abc",
    );
    expect(health?.recognised).toBe(true);
  });

  test("what a stranger is handed is not written back as a renewal", async () => {
    /*
     * An expired jar is not refused, it is answered as a stranger — and a
     * stranger is handed a fresh set of visitor cookies. Merged in, they wrote
     * an anonymous session over the remains of an account one, and the log
     * said "cookies.refreshed", which reads as a repair that had not happened.
     * Nothing short of exporting the jar again brings back what expired.
     */
    let written = 0;
    await currentCookieHealth(
      410,
      () => 1_000,
      async () => ({ signedIn: false, setCookies: ["VISITOR_INFO1_LIVE=abc; Domain=.youtube.com; Path=/"] }),
      () => "SID=stale",
      () => { written++; },
    );
    expect(cookieHealth(410)?.recognised).toBe(false);
    expect(written).toBe(0);
  });

  test("and what a known account rotates is", async () => {
    let written = 0;
    await currentCookieHealth(
      411,
      () => 1_000,
      async () => ({ signedIn: true, setCookies: ["SID=rotated; Domain=.youtube.com; Path=/"] }),
      () => "SID=live",
      () => { written++; },
    );
    expect(cookieHealth(411)?.recognised).toBe(true);
    expect(written).toBe(1);
  });

  test("a new jar is not judged by what was known of the old one", () => {
    recordCookieRecognition(405, false, () => 1_000);
    expect(cookieHealth(405)?.recognised).toBe(false);
    forgetCookieHealth(405);
    expect(cookieHealth(405)).toBe(null);
  });
});
