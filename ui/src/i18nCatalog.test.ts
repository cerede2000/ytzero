import { describe, expect, test } from "bun:test";
import { LANGUAGE_CODES, LOCALE_TAGS, normalizeLanguage, UI_LANGUAGES } from "../../shared/uiLanguages";
import { en } from "./i18n/locales/en";
import { localeLoaders } from "./i18n";

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

describe("UI language catalogue", () => {
  test("has an Intl locale and a native picker name for every supported language", () => {
    expect(LANGUAGE_CODES).toEqual(["en", "pl", "de", "fr", "es", "pt-BR", "ru", "ja", "hu"]);
    for (const code of LANGUAGE_CODES) {
      expect(UI_LANGUAGES[code].nativeName.length > 0).toBe(true);
      expect(new Intl.NumberFormat(LOCALE_TAGS[code]).format(1).length > 0).toBe(true);
    }
  });

  test("normalizes unknown persisted values to English", () => {
    expect(normalizeLanguage("fr")).toBe("fr");
    expect(normalizeLanguage("unknown")).toBe("en");
    expect(normalizeLanguage(null)).toBe("en");
  });

  test("loads a complete locale module for every non-English language", async () => {
    const englishKeys = Object.keys(en.messages).sort();
    for (const [code, load] of Object.entries(localeLoaders)) {
      const locale = await load();
      expect(Object.keys(locale.messages).sort()).toEqual(englishKeys);
      expect(locale.format.videoCount(1).length > 0).toBe(true);

      let valuesIdenticalToEnglish = 0;
      for (const key of englishKeys) {
        const typedKey = key as keyof typeof en.messages;
        const translated = locale.messages[typedKey];
        expect(translated.trim().length > 0).toBe(true);
        expect(placeholders(translated)).toEqual(placeholders(en.messages[typedKey]));
        if (translated === en.messages[typedKey]) valuesIdenticalToEnglish += 1;
      }

      // Product names and technical vocabulary can intentionally stay unchanged,
      // but a locale must never silently fall back to most of the English catalogue.
      expect(valuesIdenticalToEnglish / englishKeys.length < 0.1).toBe(true);
    }
  });
});
