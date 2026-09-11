import { describe, expect, test } from "bun:test";
import { audioSelectorFor, preferDubbedAudio } from "./audioTrackLanguage";
import { downloadFormat } from "./downloadStrategy";

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

describe("a picture and its sound fetched separately", () => {
  test("ask for the reader's dub first and fall through to what was asked before", () => {
    // Measured on N8gpdoMk6XQ, a video dubbed in fourteen languages: the plain
    // pair came back with 251-13, "English original"; led by this, 251-4,
    // "French". A video with no dub falls through to the plain pair unchanged.
    expect(downloadFormat("720", false, "fr")).toBe(
      "bestvideo[height<=720]+bestaudio[language^=fr]/bestvideo[height<=720]+bestaudio/bestvideo*[height<=720]/best[height<=720]",
    );
  });

  test("keep the compatible download compatible", () => {
    const selector = downloadFormat("1080", true, "fr").split("/");
    expect(selector[0]).toBe("bestvideo[vcodec^=avc1][height<=1080]+bestaudio[acodec^=mp4a][language^=fr]");
    expect(selector[1]).toBe("bestvideo[vcodec^=avc1][height<=1080]+bestaudio[acodec^=mp4a]");
  });

  test("change nothing for a caller that names no language", () => {
    expect(downloadFormat("best", false)).toBe("bestvideo+bestaudio/bestvideo*/best");
    expect(preferDubbedAudio("bestvideo", "bestaudio", "de")).toBe("bestvideo+bestaudio[language^=de]/");
  });
});
