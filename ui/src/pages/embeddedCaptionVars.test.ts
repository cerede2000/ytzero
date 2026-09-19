import { describe, expect, test } from "bun:test";
import { embeddedCaptionVars } from "./embeddedCaptionVars";

describe("captions handed to the embed", () => {
  test("asks for them, in the language that was resolved", () => {
    expect(embeddedCaptionVars({ defaultOn: true, language: "fr" }))
      .toEqual({ cc_load_policy: 1, cc_lang_pref: "fr" });
  });

  test("turns them off out loud when nothing asked for them", () => {
    // Saying nothing is what let the embed restore the browser's own YouTube
    // caption preference: captions off in the profile, captions on screen.
    expect(embeddedCaptionVars({ defaultOn: false, language: "fr" })).toEqual({ cc_load_policy: 0 });
    expect(embeddedCaptionVars({ defaultOn: false, language: "" })).toEqual({ cc_load_policy: 0 });
  });

  test("never names a language it is not asking for", () => {
    expect(embeddedCaptionVars({ defaultOn: false, language: "de" }).cc_lang_pref).toBe(undefined);
  });
});
