import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runIsolatedTestFile } from "../tests/isolatedTestFile";

/*
 * Whether the jar is overwritten once YouTube stops recognising it is the jar's
 * own business, and its suite covers it. What is read here is the answer that
 * judgement leaves behind: a question asked without making a request, which a
 * download's status and a suggestions panel both put to it.
 */
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
  } = await import("./youtubeCookieJar");

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const WATCH = "https://www.youtube.com/watch?v=abcdefghijk";
  const answer = (signedIn: boolean) => new Response(`{"LOGGED_IN":${signedIn}}`);
  const writeJar = (userId: number) => writeFileSync(downloadCookiesFile(userId), [
    "# Netscape HTTP Cookie File",
    "#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t2208988800\tSID\taccount",
    "",
  ].join("\n"));

  describe("what the last answer said about the account", () => {
    test("is remembered, without asking again", async () => {
      writeJar(1);
      invalidateYouTubeCookieHealth(1);
      await readYouTubeBodyWithCookies(answer(false), 1, WATCH);
      expect(knownYouTubeCookieRecognition(1)).toBe(false);

      await readYouTubeBodyWithCookies(answer(true), 1, WATCH);
      expect(knownYouTubeCookieRecognition(1)).toBe(true);
    });

    test("says nothing before any answer has been read", () => {
      expect(knownYouTubeCookieRecognition(99)).toBe(null);
    });
  });
}
