import { describe, expect, test } from "bun:test";
import { mergeByRank, providerPath } from "./searchProviderTypes";

describe("results from several providers in one list", () => {
  test("merged by rank, so no provider is given the top of the page", () => {
    // Relevance is not a shared quantity: one provider's tenth is not worse
    // than another's fifth. Appending one list to the other would say it is.
    expect(mergeByRank([["a1", "a2", "a3"], ["b1", "b2"]])).toEqual(["a1", "b1", "a2", "b2", "a3"]);
  });

  test("a provider with nothing to say costs the list nothing", () => {
    expect(mergeByRank([[], ["b1", "b2"]])).toEqual(["b1", "b2"]);
    expect(mergeByRank([])).toEqual([]);
    expect(mergeByRank([[]])).toEqual([]);
  });

  test("each provider keeps its own order inside the merge", () => {
    const merged = mergeByRank([["a1", "a2"], ["b1", "b2"]]);
    expect(merged.filter((item) => item.startsWith("a"))).toEqual(["a1", "a2"]);
    expect(merged.filter((item) => item.startsWith("b"))).toEqual(["b1", "b2"]);
  });
});

describe("where a card leads", () => {
  test("the provider says, rather than the page assuming", () => {
    expect(providerPath("/watch/:id", "dQw4w9WgXcQ")).toBe("/watch/dQw4w9WgXcQ");
    expect(providerPath("/dailymotion/video/:id", "xacfsqi")).toBe("/dailymotion/video/xacfsqi");
  });

  test("an id is escaped rather than trusted into the path", () => {
    expect(providerPath("/watch/:id", "../admin")).toBe("/watch/..%2Fadmin");
  });
});
