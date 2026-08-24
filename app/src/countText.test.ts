import { describe, expect, test } from "bun:test";
import { readCount } from "./countText";

/**
 * Measured against youtube.com, one request per language, on channels and
 * videos picked for the shapes rather than the content. Every row here is
 * something YouTube actually wrote.
 */
const REAL: Array<[string, string, number]> = [
  ["en", "12K views", 12_000],
  ["en", "4.7M views", 4_700_000],
  ["en", "1,234 views", 1_234],
  ["en", "620K subscribers", 620_000],
  ["en", "1.2K videos", 1_200],
  ["en", "532 views", 532],
  ["en", "1.4B views", 1_400_000_000],
  ["fr", "12 k vues", 12_000],
  ["fr", "4,7 M de vues", 4_700_000],
  ["fr", "1,2 k vues", 1_200],
  ["fr", "532 vues", 532],
  ["fr", "4,7 M d\u2019abonn\u00e9s", 4_700_000],
  ["fr", "1\u202f234 vues", 1_234],
  ["fr", "2,3 Md de vues", 2_300_000_000],
  ["de", "12.345 Aufrufe", 12_345],
  ["de", "4,7 Mio. Aufrufe", 4_700_000],
  ["de", "620 Tsd. Abonnenten", 620_000],
  ["de", "1,4 Mrd. Aufrufe", 1_400_000_000],
  ["pl", "12 tys. wy\u015bwietle\u0144", 12_000],
  ["pl", "4,7 mln wy\u015bwietle\u0144", 4_700_000],
  ["pl", "1,2 tys.", 1_200],
  ["pl", "2,3 mld wy\u015bwietle\u0144", 2_300_000_000],
];

describe("reading a count YouTube wrote", () => {
  for (const [language, text, expected] of REAL) {
    test(`${language}: ${text}`, () => expect(readCount(text)).toBe(expected));
  }

  /*
   * The two failures that started this. Both returned a number, which is the
   * dangerous kind: nothing downstream refuses it, it is simply displayed.
   * A channel with six hundred and twenty thousand subscribers read as having
   * six hundred and twenty of them.
   */
  test("does not read a grouping space as the end of the number", () => {
    expect(readCount("1\u202f234 vues")).toBe(1_234);
    expect(readCount("4\u00a0700\u00a0000 vues")).toBe(4_700_000);
  });

  test("does not drop a magnitude it has not been taught", () => {
    expect(readCount("620 Tsd. Abonnenten")).toBe(620_000);
    expect(readCount("1,2 tys. film\u00f3w")).toBe(1_200);
  });

  test("declines what is not a count at all", () => {
    expect(readCount("PP World")).toBeNull();
    expect(readCount("")).toBeNull();
    expect(readCount(undefined)).toBeNull();
    expect(readCount("aucune vue")).toBeNull();
  });

  /*
   * The panel reads a list where a date sits beside the count, and a date is
   * full of numbers. `bare` is the caller saying it expects a count and
   * nothing else.
   */
  describe("when the caller expects a count and nothing else", () => {
    test("reads a plain count", () => {
      expect(readCount("12 k", { bare: true })).toBe(12_000);
      expect(readCount("4,7 M", { bare: true })).toBe(4_700_000);
      expect(readCount("532", { bare: true })).toBe(532);
    });

    test("refuses a date, which is otherwise a number with a word after it", () => {
      expect(readCount("il y a 2 semaines", { bare: true })).toBeNull();
      expect(readCount("vor 1 Monat", { bare: true })).toBeNull();
      expect(readCount("2 days ago", { bare: true })).toBeNull();
    });
  });
});
