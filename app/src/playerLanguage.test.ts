import { describe, expect, test } from "bun:test";
import { SETTING_DEFAULTS } from "./db";
import { PROFILE_PLAYER_LANGUAGE, resolvePlayerLanguage } from "../../shared/playerLanguage";

describe("the language the player is asked to speak", () => {
  test("follows the profile when nobody chose one", () => {
    // What a profile gets without ever opening the player settings. The embed
    // reads this as `hl`, which on a dubbed video picks the audio track and the
    // captions: an instance read in French must not ask YouTube in English.
    expect(resolvePlayerLanguage(SETTING_DEFAULTS.player_hl, "fr")).toBe("fr");
    expect(resolvePlayerLanguage(SETTING_DEFAULTS.player_cc_lang, "fr")).toBe("fr");
  });

  test("keeps a language that was chosen", () => {
    expect(resolvePlayerLanguage("en", "fr")).toBe("en");
    expect(resolvePlayerLanguage("ja", "fr")).toBe("ja");
  });

  test("never hands the sentinel itself to YouTube", () => {
    expect(resolvePlayerLanguage(PROFILE_PLAYER_LANGUAGE, "de")).toBe("de");
    expect(resolvePlayerLanguage("", "de")).toBe("de");
    expect(resolvePlayerLanguage(undefined, "de")).toBe("de");
    expect(resolvePlayerLanguage(null, "de")).toBe("de");
  });
});
