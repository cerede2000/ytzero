import { describe, expect, test } from "bun:test";
import { feedSize, feedWindow } from "./authRoutes";
import { pageNumber } from "./paging";

describe("the page a client asked for", () => {
  test("is the one it named", () => {
    expect(pageNumber("2")).toBe(2);
    expect(pageNumber("17")).toBe(17);
  });

  test("is the first one when it named nothing sensible", () => {
    expect(pageNumber(undefined)).toBe(1);
    expect(pageNumber("0")).toBe(1);
    expect(pageNumber("-3")).toBe(1);
    expect(pageNumber("all")).toBe(1);
  });
});

describe("which slice of the feed one answer carries", () => {
  /*
   * The bug this exists to prevent: a client scrolling the feed asks for page
   * two and appends what comes back. Answering page one again is a list that
   * repeats itself for as long as somebody keeps scrolling.
   */
  test("moves on with the page", () => {
    expect(feedWindow("50", "1")).toEqual({ limit: 50, offset: 0 });
    expect(feedWindow("50", "2")).toEqual({ limit: 50, offset: 50 });
    expect(feedWindow("50", "3")).toEqual({ limit: 50, offset: 100 });
  });

  test("counts in the pages the client asked the size of", () => {
    expect(feedWindow(undefined, "3")).toEqual({ limit: feedSize(undefined), offset: 2 * feedSize(undefined) });
    // Asking for more than a feed will give still pages by what it gave.
    expect(feedWindow("5000", "2")).toEqual({ limit: 200, offset: 200 });
  });

  test("starts at the beginning when no page was asked for", () => {
    expect(feedWindow("50", undefined).offset).toBe(0);
  });
});
