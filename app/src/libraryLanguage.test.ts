import { afterEach, describe, expect, test } from "bun:test";
import { configureLibraryLanguageProvider, libraryLanguage } from "./libraryLanguage";

const original = process.env.YOUTUBE_METADATA_LANGUAGE;
afterEach(() => {
  if (original === undefined) delete process.env.YOUTUBE_METADATA_LANGUAGE;
  else process.env.YOUTUBE_METADATA_LANGUAGE = original;
  configureLibraryLanguageProvider(() => "en");
});

describe("the language the shared library is written in", () => {
  test("English until somebody says otherwise", () => {
    // Every script and test that imports this reaches it before any profile
    // exists, so it has to answer something rather than reach for a database.
    delete process.env.YOUTUBE_METADATA_LANGUAGE;
    expect(libraryLanguage()).toBe("en");
  });

  test("the primary profile's choice, once the app has wired it up", () => {
    delete process.env.YOUTUBE_METADATA_LANGUAGE;
    configureLibraryLanguageProvider(() => "fr");
    expect(libraryLanguage()).toBe("fr");
  });

  test("an environment override outranks the profile", () => {
    // For a household whose library should be kept in a language none of their
    // interfaces happens to use — or to pin it back to English.
    configureLibraryLanguageProvider(() => "fr");
    process.env.YOUTUBE_METADATA_LANGUAGE = "de";
    expect(libraryLanguage()).toBe("de");
  });

  test("a language nobody parses falls back rather than being sent", () => {
    // Asking YouTube in a language the date grammars do not know would store
    // titles nothing here can read the ages of.
    configureLibraryLanguageProvider(() => "fr");
    process.env.YOUTUBE_METADATA_LANGUAGE = "es";
    expect(libraryLanguage()).toBe("en");
  });

  test("a regional tag is read as its language", () => {
    configureLibraryLanguageProvider(() => "en");
    process.env.YOUTUBE_METADATA_LANGUAGE = "fr-FR";
    expect(libraryLanguage()).toBe("fr");
  });
});

describe("an instance that was already told a language", () => {
  const upstreamName = process.env.YTZERO_YT_LANGUAGE;
  afterEach(() => {
    if (upstreamName === undefined) delete process.env.YTZERO_YT_LANGUAGE;
    else process.env.YTZERO_YT_LANGUAGE = upstreamName;
  });

  // The same setting has two names in the wild. Reading only one of them would
  // quietly send every request back to English on an instance set up with the
  // other, which is the setting doing the opposite of what it was set for.
  test("is heard under either name", () => {
    delete process.env.YOUTUBE_METADATA_LANGUAGE;
    process.env.YTZERO_YT_LANGUAGE = "pl";
    expect(libraryLanguage()).toBe("pl");
  });

  test("prefers this fork's own name when both are set", () => {
    process.env.YOUTUBE_METADATA_LANGUAGE = "de";
    process.env.YTZERO_YT_LANGUAGE = "pl";
    expect(libraryLanguage()).toBe("de");
  });
});
