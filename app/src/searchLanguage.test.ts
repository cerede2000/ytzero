import { describe, expect, test } from "bun:test";
import { languageAsked } from "./searchLanguage";

describe("the language a search is answered in", () => {
  test("is the one the page says it is rendering in", () => {
    // Measured on 5w-MZERFb4g with the profile row saying "en" and the
    // interface in French: without this the search answered "Looking back: The
    // Facel Vega saga!" for a video whose own title is "Dans le rétro : La
    // saga Facel Vega !".
    expect(languageAsked("fr", "en")).toBe("fr");
    expect(languageAsked("de", "fr")).toBe("de");
  });

  test("falls back only when nobody said", () => {
    expect(languageAsked(null, "fr")).toBe("fr");
    expect(languageAsked(undefined, "de")).toBe("de");
    expect(languageAsked("", "pl")).toBe("pl");
  });

  test("reads a locale as its language", () => {
    // Clients send both shapes; "fr-FR" is French however it is spelled.
    expect(languageAsked("fr-FR", "en")).toBe("fr");
    expect(languageAsked("PL-pl", "en")).toBe("pl");
  });

  test("answers in English for a language nothing here can read", () => {
    // The counts and dates on those cards come back in the language asked for,
    // and only four are parsed. Asking for one of the others would hand back
    // numbers nothing downstream can read.
    expect(languageAsked("es", "fr")).toBe("en");
    expect(languageAsked("ja", "fr")).toBe("en");
  });
});
