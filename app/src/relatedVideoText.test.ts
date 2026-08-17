import { describe, expect, test } from "bun:test";
import { acceptLanguage, looksLikeCount, looksLikePublished, panelLanguage, parseCompactCount, parseCompactPublishedText } from "./relatedVideoText";

describe("reading an age the way each language writes it", () => {
  test("English", () => {
    expect(parseCompactPublishedText("13 hours ago", "en")).toEqual({ value: 13, unit: "hour" });
    expect(parseCompactPublishedText("1mo ago", "en")).toEqual({ value: 1, unit: "month" });
    expect(parseCompactPublishedText("3w ago", "en")).toEqual({ value: 3, unit: "week" });
  });

  test("French, where a month is 'mois' and a minute is 'min'", () => {
    expect(parseCompactPublishedText("il y a 13 h", "fr")).toEqual({ value: 13, unit: "hour" });
    expect(parseCompactPublishedText("il y a 2 sem.", "fr")).toEqual({ value: 2, unit: "week" });
    expect(parseCompactPublishedText("il y a 1 mois", "fr")).toEqual({ value: 1, unit: "month" });
    expect(parseCompactPublishedText("il y a 4 j", "fr")).toEqual({ value: 4, unit: "day" });
    expect(parseCompactPublishedText("il y a 2 ans", "fr")).toEqual({ value: 2, unit: "year" });
    expect(parseCompactPublishedText("il y a 30 min", "fr")).toEqual({ value: 30, unit: "minute" });
  });

  test("German", () => {
    expect(parseCompactPublishedText("vor 13 Std.", "de")).toEqual({ value: 13, unit: "hour" });
    expect(parseCompactPublishedText("vor 2 Wo.", "de")).toEqual({ value: 2, unit: "week" });
    expect(parseCompactPublishedText("vor 1 Mon.", "de")).toEqual({ value: 1, unit: "month" });
  });

  test("Polish, where the unit comes before 'temu'", () => {
    expect(parseCompactPublishedText("13 godz. temu", "pl")).toEqual({ value: 13, unit: "hour" });
    expect(parseCompactPublishedText("2 tyg. temu", "pl")).toEqual({ value: 2, unit: "week" });
    expect(parseCompactPublishedText("4 dni temu", "pl")).toEqual({ value: 4, unit: "day" });
  });

  test("a language's age is not another's", () => {
    // The channel is found by elimination — whichever part is neither a count
    // nor an age. A grammar that does not know the language does not merely
    // lose the age: it starts reading the age as the channel's name.
    expect(parseCompactPublishedText("il y a 2 sem.", "en")).toBe(null);
    expect(parseCompactPublishedText("3w ago", "fr")).toBe(null);
  });
});

describe("reading a count the way each language writes it", () => {
  test("the same two characters, opposite meanings", () => {
    // "1,6" is one and six tenths in French and one thousand six hundred in
    // English.
    expect(parseCompactCount("1.6M", "en")).toBe(1_600_000);
    expect(parseCompactCount("1,6 M", "fr")).toBe(1_600_000);
    expect(parseCompactCount("1,600", "en")).toBe(1600);
  });

  test("each language's own magnitudes", () => {
    expect(parseCompactCount("699K", "en")).toBe(699_000);
    expect(parseCompactCount("699 k", "fr")).toBe(699_000);
    expect(parseCompactCount("699 Tsd.", "de")).toBe(699_000);
    expect(parseCompactCount("699 tys.", "pl")).toBe(699_000);
    expect(parseCompactCount("1,6 Mio.", "de")).toBe(1_600_000);
    expect(parseCompactCount("1,6 mln", "pl")).toBe(1_600_000);
  });

  test("a bare number needs no magnitude at all", () => {
    expect(parseCompactCount("539", "en")).toBe(539);
    expect(parseCompactCount("925", "fr")).toBe(925);
  });

  test("thousands grouped by a space, narrow or not", () => {
    expect(parseCompactCount("72 000", "fr")).toBe(72_000);
    expect(parseCompactCount("72 000", "fr")).toBe(72_000);
  });

  test("what is not a count says so", () => {
    expect(parseCompactCount("Screen Bites", "en")).toBe(null);
    expect(parseCompactCount("il y a 2 sem.", "fr")).toBe(null);
    expect(looksLikeCount("PP World", "fr")).toBe(false);
    expect(looksLikePublished("PP World", "fr")).toBe(false);
  });
});

describe("choosing the language to ask in", () => {
  test("the four the interface speaks, and English for anything else", () => {
    expect(panelLanguage("fr")).toBe("fr");
    expect(panelLanguage("de")).toBe("de");
    expect(panelLanguage("pl")).toBe("pl");
    expect(panelLanguage("es")).toBe("en");
    expect(panelLanguage(null)).toBe("en");
  });

  test("asked for as a header YouTube honours", () => {
    expect(acceptLanguage("fr")).toBe("fr-FR,fr;q=0.9");
    expect(acceptLanguage("en")).toBe("en-US,en;q=0.9");
  });
});

describe("a count that spells out what it counts", () => {
  test("the endpoint writes what the page leaves out", () => {
    // The page's lockups write "699 k"; the same count from YouTube's own
    // endpoint arrives as "699 k vues". Read without allowing for the word,
    // the card loses its views and its age at once.
    expect(parseCompactCount("699 k vues", "fr")).toBe(699_000);
    expect(parseCompactCount("1,6 M de vues", "fr")).toBe(1_600_000);
    expect(parseCompactCount("699K views", "en")).toBe(699_000);
    expect(parseCompactCount("699 Tsd. Aufrufe", "de")).toBe(699_000);
    expect(parseCompactCount("699 tys. wyświetleń", "pl")).toBe(699_000);
    expect(parseCompactCount("1 vue", "fr")).toBe(1);
  });
});
