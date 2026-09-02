import { describe, expect, test } from "bun:test";
import {
  normalizeYouTubeTitleLanguage,
  rewriteYouTubePrefLanguage,
  youtubeCookieHeaderFromNetscape,
} from "./youtubeRequestLanguage";

describe("YouTube request language", () => {
  test("normalizes the portable title-language setting", () => {
    expect(normalizeYouTubeTitleLanguage("profile")).toBe("profile");
    expect(normalizeYouTubeTitleLanguage("fr")).toBe("fr");
    expect(normalizeYouTubeTitleLanguage("unsupported")).toBe("profile");
  });

  test("rewrites only PREF hl and preserves every other preference", () => {
    expect(rewriteYouTubePrefLanguage("f6=400&hl=en&tz=Europe.Warsaw", "fr")).toBe(
      "f6=400&hl=fr&tz=Europe.Warsaw",
    );
    expect(rewriteYouTubePrefLanguage("f6=400", "pt-BR")).toBe("f6=400&hl=pt-BR");
  });

  test("loads live YouTube cookies while excluding other domains and expired values", () => {
    const jar = [
      "# Netscape HTTP Cookie File",
      ".youtube.com\tTRUE\t/\tTRUE\t4102444800\tPREF\tf6=400&hl=en&tz=Europe.Warsaw",
      "#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t4102444800\tSID\tsecret-session",
      ".youtube.com\tTRUE\t/\tTRUE\t1\tEXPIRED\told",
      ".google.com\tTRUE\t/\tTRUE\t4102444800\tOTHER\tignored",
    ].join("\n");
    const header = youtubeCookieHeaderFromNetscape(jar, "fr", 2_000_000_000);
    expect(header).toContain("PREF=f6=400&hl=fr&tz=Europe.Warsaw");
    expect(header).toContain("SID=secret-session");
    expect(header).not.toContain("EXPIRED=");
    expect(header).not.toContain("OTHER=");
  });
});
