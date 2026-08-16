import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { frenchFor, overlayKeys } from "../src/i18n/frenchOverlay";

/**
 * The screens that translate themselves inline, and the shapes they do it in.
 *
 * The overlay is keyed by the English already written in these files, so the
 * one way it can go wrong is silent: upstream rewords a string, the key stops
 * matching, and a French reader quietly sees English. Reading the sources back
 * and comparing is what turns that into a failing build.
 */
const SOURCES = [
  "ui/src/components/DownloadAutomation.tsx",
  "ui/src/components/DownloadConfiguration.tsx",
  "ui/src/components/DatabaseSettings.tsx",
  "ui/src/pages/RestorePage.tsx",
  "ui/src/pages/DownloadsPage.tsx",
  "ui/src/components/settings/TubeArchivistSettings.tsx",
];

function read(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

/** Every double-quoted English string these files can show a reader. */
function englishInSources(): Set<string> {
  const found = new Set<string>();
  for (const path of SOURCES) {
    const source = read(path);
    // The first argument of every tx(...) call, and the section labels the
    // backup page keeps in a map of its own.
    for (const match of source.matchAll(/\btx\(\s*"((?:[^"\\]|\\.)*)"/g)) found.add(JSON.parse(`"${match[1]}"`));
    const labels = source.match(/const LABELS: Record<string, string> = \{([\s\S]*?)\n\};/);
    if (labels) for (const match of labels[1].matchAll(/:\s*"((?:[^"\\]|\\.)*)"/g)) found.add(JSON.parse(`"${match[1]}"`));
  }
  return found;
}

describe("French for the screens that translate themselves", () => {
  test("translates every string those screens can show", () => {
    const english = englishInSources();
    const untranslated = [...english].filter((text) => frenchFor(text) === undefined);
    expect(untranslated).toEqual([]);
  });

  test("has no key upstream has since reworded", () => {
    const english = englishInSources();
    const elsewhere = [
      // Served by the API too, and translated on both sides.
      "Download schedule", "Days",
      // Backup sections the page has no label for in any language: it prints
      // the raw id, and these say what they are instead.
      "instance.downloads", "profile.avatar", "profile.downloads",
    ];
    expect(overlayKeys().filter((key) => !english.has(key) && !elsewhere.includes(key))).toEqual([]);
  });

  test("is consulted for French and left out of every other language", () => {
    // A guard on the wiring rather than on the dictionary: an overlay read
    // outside the French branch would hand Polish readers French.
    for (const path of SOURCES) {
      const source = read(path);
      if (!source.includes("frenchFor(")) continue;
      for (const line of source.split("\n")) {
        if (line.includes("frenchFor(")) expect(line.includes('language === "fr"')).toBe(true);
      }
    }
  });
});
