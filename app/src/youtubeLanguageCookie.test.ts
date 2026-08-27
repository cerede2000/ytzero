import { describe, expect, test } from "bun:test";
import { languageHeaders, withLanguagePreference } from "./youtubeLanguageCookie";

describe("the language preference inside a YouTube cookie jar", () => {
  test("replaces the one the jar was exported with", () => {
    // The measured case: a jar from a browser set to English, an instance
    // asking in French, and every title coming back in English.
    expect(withLanguagePreference("SID=abc; PREF=f6=40000000&hl=en&tz=Europe.Paris; SSID=def", "fr"))
      .toBe("SID=abc; PREF=f6=40000000&hl=fr&tz=Europe.Paris; SSID=def");
  });

  test("adds it to a jar whose preferences never mentioned a language", () => {
    expect(withLanguagePreference("PREF=f6=40000000", "de")).toBe("PREF=f6=40000000&hl=de");
  });

  test("adds the cookie itself when the jar has none", () => {
    expect(withLanguagePreference("SID=abc", "pl")).toBe("SID=abc; PREF=hl=pl");
    expect(withLanguagePreference(null, "fr")).toBe("PREF=hl=fr");
    expect(withLanguagePreference("", "fr")).toBe("PREF=hl=fr");
  });

  test("leaves every other cookie exactly as it was given", () => {
    // The session and its authorisation are what YouTube reads to know who is
    // asking. A jar that comes back altered is a jar that stops working.
    const jar = "SID=a; __Secure-1PSID=b; SAPISID=c; PREF=hl=en; LOGIN_INFO=d";
    const asked = withLanguagePreference(jar, "fr");
    expect(asked.split("; ").filter((cookie) => !cookie.startsWith("PREF=")))
      .toEqual(["SID=a", "__Secure-1PSID=b", "SAPISID=c", "LOGIN_INFO=d"]);
  });

  test("does not mistake another preference that starts with the same letters", () => {
    expect(withLanguagePreference("PREF=hlbest=1&f6=8", "fr")).toBe("PREF=hlbest=1&f6=8&hl=fr");
  });

  test("states the same language in the header and in the jar", () => {
    const headers = languageHeaders("PREF=hl=en", "fr");
    expect(headers["Accept-Language"]).toBe("fr-FR,fr;q=0.9");
    expect(headers.Cookie).toBe("PREF=hl=fr");
  });
});
