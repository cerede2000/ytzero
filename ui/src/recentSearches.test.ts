import { describe, expect, test } from "bun:test";
import { matchingRecentSearches, parseRecentSearches, RECENT_SEARCH_LIMIT, withRecentSearch } from "./recentSearches";

describe("keeping what this profile searched for", () => {
  test("the newest first, however it was spelled before", () => {
    // Searching "Veritasium" after "veritasium" is the same search, and two
    // lines of it is noise. The new spelling wins, in the new position.
    expect(withRecentSearch(["lofi", "veritasium"], "Veritasium")).toEqual(["Veritasium", "lofi"]);
  });

  test("a repeat moves up rather than piling up", () => {
    expect(withRecentSearch(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  });

  test("blank searches are not searches", () => {
    expect(withRecentSearch(["a"], "   ")).toEqual(["a"]);
    expect(withRecentSearch([], "")).toEqual([]);
  });

  test("the list stays a shortlist", () => {
    const many = Array.from({ length: RECENT_SEARCH_LIMIT + 5 }, (_, index) => `q${index}`);
    expect(withRecentSearch(many, "new").length).toBe(RECENT_SEARCH_LIMIT);
    expect(withRecentSearch(many, "new")[0]).toBe("new");
  });
});

describe("reading back what was stored", () => {
  test("anything that is not a list of searches is no searches", () => {
    expect(parseRecentSearches(null)).toEqual([]);
    expect(parseRecentSearches("not json")).toEqual([]);
    expect(parseRecentSearches('{"a":1}')).toEqual([]);
    expect(parseRecentSearches('[1, true, null]')).toEqual([]);
  });

  test("duplicates and blanks are dropped on the way in", () => {
    expect(parseRecentSearches('["a", "A", "  ", "b"]')).toEqual(["a", "b"]);
  });
});

describe("which of them to offer", () => {
  const recent = ["veritasium", "veritasium fr", "lofi", "vélo électrique"];

  test("an empty box offers the lot, which is when they are most useful", () => {
    expect(matchingRecentSearches(recent, "", 3)).toEqual(["veritasium", "veritasium fr", "lofi"]);
  });

  test("once there is text, only what continues it", () => {
    // A recent search that merely contains the letters somewhere is a
    // coincidence, not a memory.
    expect(matchingRecentSearches(recent, "ver")).toEqual(["veritasium", "veritasium fr"]);
    expect(matchingRecentSearches(recent, "lo")).toEqual(["lofi"]);
    expect(matchingRecentSearches(recent, "fi")).toEqual([]);
  });

  test("what was typed exactly is not offered back to itself", () => {
    expect(matchingRecentSearches(recent, "lofi")).toEqual([]);
    expect(matchingRecentSearches(recent, "veritasium")).toEqual(["veritasium fr"]);
  });

  test("case is not part of the question", () => {
    expect(matchingRecentSearches(recent, "VER")).toEqual(["veritasium", "veritasium fr"]);
  });
});
