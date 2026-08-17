import { describe, expect, test } from "bun:test";
import { audioSelectorFor } from "./audioTrackLanguage";

describe("asking for the track in the reader's language", () => {
  test("the preference comes first and the original still answers", () => {
    // The fallbacks matter more than the preference: most videos carry one
    // track, and asking for French on a video made in English must not come
    // back empty-handed.
    const selector = audioSelectorFor("fr").split("/");
    expect(selector[0]).toBe("bestaudio[acodec^=mp4a][language^=fr]");
    expect(selector[1]).toBe("bestaudio[language^=fr]");
    expect(selector.slice(2)).toEqual(["bestaudio[acodec^=mp4a]", "bestaudio[ext=m4a]", "140", "bestaudio", "best"]);
  });

  test("a prefix, because YouTube tags the region as well as the language", () => {
    // Measured on a French upload: the track is tagged fr-FR, not fr. An exact
    // match would ask for the reader's language and be handed the original.
    expect(audioSelectorFor("fr").startsWith("bestaudio[acodec^=mp4a][language^=fr]")).toBe(true);
    expect(audioSelectorFor("de").includes("[language^=de]")).toBe(true);
  });
});
