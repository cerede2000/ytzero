import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runIsolatedTestFile } from "../tests/isolatedTestFile";

const ISOLATION_FLAG = "YTZERO_COOKIE_JAR_RECOGNITION_TEST_ISOLATED";
if (process.env[ISOLATION_FLAG] !== "1") {
  test("cookie jar recognition suite runs in an isolated application runtime", async () => {
    await runIsolatedTestFile("src/youtubeCookieJarRecognition.test.ts", ISOLATION_FLAG);
  });
} else {
  const root = mkdtempSync(resolve(tmpdir(), "ytzero-cookie-jar-recognition-"));
  process.env.DB_PATH = resolve(root, "db.sqlite");
  process.env.DOWNLOAD_COOKIES_DIR = resolve(root, "cookies");

  const { downloadCookiesFile } = await import("./downloadConfig");
  const {
    invalidateYouTubeCookieHealth,
    knownYouTubeCookieRecognition,
    readYouTubeBodyWithCookies,
    readYouTubeResponseWithCookies,
  } = await import("./youtubeCookieJar");

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const WATCH = "https://www.youtube.com/watch?v=abcdefghijk";
  const jar = (sid: string) => [
    "# Netscape HTTP Cookie File",
    `#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t2208988800\tSID\t${sid}`,
    "",
  ].join("\n");
  const answer = (signedIn: boolean, sid: string) => new Response(`{"LOGGED_IN":${signedIn}}`, {
    headers: [["Set-Cookie", `SID=${sid}; Domain=.youtube.com; Path=/; Expires=Sun, 1 Jan 2040 00:00:00 GMT; Secure; HttpOnly`]],
  });
  const onDisk = () => readFileSync(downloadCookiesFile(1), "utf8");

  describe("a jar YouTube no longer recognises", () => {
    test("is not overwritten with the cookies a stranger is handed", async () => {
      // An expired jar is answered as a stranger, with fresh visitor cookies.
      // Written over the account's, they leave nothing an export could not
      // have kept — so the answer that says "not recognised" writes nothing.
      writeFileSync(downloadCookiesFile(1), jar("account"));
      invalidateYouTubeCookieHealth(1);
      await readYouTubeBodyWithCookies(answer(false, "visitor"), 1, WATCH);
      expect(onDisk()).toContain("\tSID\taccount");
      expect(knownYouTubeCookieRecognition(1)).toBe(false);

      await readYouTubeResponseWithCookies(answer(false, "visitor-again"), "fetch failed", 1, WATCH);
      expect(onDisk()).toContain("\tSID\taccount");
    });

    test("is renewed as usual while the account is recognised", async () => {
      writeFileSync(downloadCookiesFile(1), jar("account"));
      invalidateYouTubeCookieHealth(1);
      await readYouTubeBodyWithCookies(answer(true, "rotated"), 1, WATCH);
      expect(onDisk()).toContain("\tSID\trotated");
      expect(knownYouTubeCookieRecognition(1)).toBe(true);
    });

    test("says nothing before any answer has been read", () => {
      invalidateYouTubeCookieHealth(1);
      expect(knownYouTubeCookieRecognition(1)).toBe(null);
    });
  });
}
