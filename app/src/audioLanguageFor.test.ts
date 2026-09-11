import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runIsolatedTestFile } from "../tests/isolatedTestFile";

const ISOLATION_FLAG = "YTZERO_AUDIO_LANGUAGE_FOR_TEST_ISOLATED";
if (process.env[ISOLATION_FLAG] !== "1") {
  test("audio language suite runs in an isolated application runtime", async () => {
    await runIsolatedTestFile("src/audioLanguageFor.test.ts", ISOLATION_FLAG);
  });
} else {
  const root = mkdtempSync(resolve(tmpdir(), "ytzero-audio-language-for-"));
  process.env.DB_PATH = resolve(root, "db.sqlite");

  const { setUserSetting } = await import("./db");
  const { audioLanguageFor } = await import("./audioTrackLanguage");

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  describe("the dub a profile is played in", () => {
    test("is the language it reads, when nobody chose a player language", async () => {
      await setUserSetting(1, "language", "fr");
      expect(audioLanguageFor(1)).toBe("fr");
    });

    test("is the player language when one was chosen", async () => {
      // One setting for the dub, the captions and the embed's own controls:
      // somebody who reads French but set the player to English hears English.
      await setUserSetting(1, "language", "fr");
      await setUserSetting(1, "player_hl", "en");
      expect(audioLanguageFor(1)).toBe("en");
      await setUserSetting(1, "player_hl", "profile");
      expect(audioLanguageFor(1)).toBe("fr");
    });
  });
}
