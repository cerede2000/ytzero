import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DOWNLOADS_SETTINGS, localizeDownloadSettings } from "./downloadSettings";
import { frenchSettingText, settingOverlayKeys } from "./frenchSettingsText";

/**
 * Every English string `localizeDownloadSettings` can hand out.
 *
 * The subtitle-language picker is left out: its options are the languages
 * named in their own script — 日本語, ქართული — which is what a reader wants
 * to see whatever language the interface is in.
 */
function englishSettingStrings(): Set<string> {
  const strings = new Set<string>();
  for (const definition of DOWNLOADS_SETTINGS) {
    strings.add(definition.label.en);
    strings.add(definition.description.en);
    if (definition.key === "sub_langs") continue;
    for (const option of definition.options ?? []) strings.add(option.label.en);
  }
  return strings;
}

describe("French for settings the API translates itself", () => {
  test("answers in French for a profile reading French", () => {
    const french = localizeDownloadSettings("fr");
    const quality = french.find((definition) => definition.key === "quality");
    expect(quality?.label).toBe("Qualité vidéo");
    expect(quality?.options?.[0]?.label).toBe("La meilleure disponible");
  });

  test("leaves the three languages the definitions carry exactly as they are", () => {
    expect(localizeDownloadSettings("pl").find((d) => d.key === "quality")?.label).toBe("Jakość wideo");
    expect(localizeDownloadSettings("de").find((d) => d.key === "quality")?.label).toBe("Videoqualität");
    expect(localizeDownloadSettings("en").find((d) => d.key === "quality")?.label).toBe("Video quality");
    expect(localizeDownloadSettings(null).find((d) => d.key === "quality")?.label).toBe("Video quality");
  });

  test("translates every string a reader can see", () => {
    // The overlay is keyed by English, so a setting added upstream simply
    // arrives untranslated. Naming it here is how it gets noticed.
    const untranslated = [...englishSettingStrings()].filter((text) => frenchSettingText(text) === text);
    // What is left over reads the same in every language: the resolutions and
    // the day numbers.
    expect(untranslated.filter((text) => !/^\d+p?$/.test(text))).toEqual([]);
  });

  test("has no key upstream has since reworded", () => {
    // The failure this shape invites: a string is edited upstream, the key
    // stops matching, and French quietly reverts to English. It fails here
    // instead, naming the entry to update.
    const english = englishSettingStrings();
    expect(settingOverlayKeys().filter((key) => !english.has(key))).toEqual([]);
  });

  test("is read for French and for nothing else", () => {
    // A guard on the wiring rather than the dictionary: `say` must be the
    // identity for every other language, or Polish would be handed French.
    const source = readFileSync(new URL("./downloadSettings.ts", import.meta.url), "utf8");
    expect(source).toContain('language === "fr" ? frenchSettingText');
  });
});
