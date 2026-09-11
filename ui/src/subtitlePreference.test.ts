import { describe, expect, test } from "bun:test";
import { preferredSubtitle } from "./subtitlePreference";

const track = (lang: string) => ({ lang, label: lang });

describe("the subtitle track turned on for a reader", () => {
  test("takes the language under another region before any other language", () => {
    // A dubbed video names its French track fr-FR; the reader asked for fr.
    const subs = [track("id"), track("de"), track("en"), track("fr-FR"), track("pl")];
    expect(preferredSubtitle(subs, "fr")).toBe("fr-FR");
  });

  test("prefers the exact name when both are there", () => {
    expect(preferredSubtitle([track("fr-FR"), track("fr"), track("en")], "fr")).toBe("fr");
  });

  test("falls back to the first track only when the language is absent", () => {
    expect(preferredSubtitle([track("de"), track("en")], "fr")).toBe("de");
  });

  test("says nothing it cannot back up", () => {
    expect(preferredSubtitle([], "fr")).toBe("fr");
    expect(preferredSubtitle([track("de")], null)).toBe("de");
  });
});
