import { describe, expect, test } from "bun:test";
import { localisedTitleFromInitialData } from "./youtube";

/**
 * The shape of the block the watch page draws its heading from, which is not
 * the block the player response carries. Asked for in French, YouTube answers
 * a Japanese video's heading in French and leaves the uploader's own title in
 * the player response beside it.
 */
const watchPage = (title: string) => ({
  contents: {
    twoColumnWatchNextResults: {
      results: {
        results: {
          contents: [
            { videoSecondaryInfoRenderer: { owner: {} } },
            { videoPrimaryInfoRenderer: { title: { runs: [{ text: title }] } } },
          ],
        },
      },
    },
  },
});

describe("the title YouTube shows a reader", () => {
  test("is read from the heading, wherever it sits among the blocks", () => {
    expect(localisedTitleFromInitialData(watchPage("Culture de champignons shiitakés séchés")))
      .toBe("Culture de champignons shiitakés séchés");
  });

  test("is the runs joined, because YouTube splits a heading as it pleases", () => {
    const page = watchPage("");
    page.contents.twoColumnWatchNextResults.results.results.contents[1]
      .videoPrimaryInfoRenderer!.title.runs = [{ text: "Culture " }, { text: "et transformation" }];
    expect(localisedTitleFromInitialData(page)).toBe("Culture et transformation");
  });

  /* Nothing invented: no heading, no answer, and the uploader's title stands. */
  test("is nothing when the page carries none", () => {
    expect(localisedTitleFromInitialData(undefined)).toBeNull();
    expect(localisedTitleFromInitialData({})).toBeNull();
    expect(localisedTitleFromInitialData(watchPage(""))).toBeNull();
    expect(localisedTitleFromInitialData({ contents: { twoColumnWatchNextResults: { results: { results: { contents: "no" } } } } })).toBeNull();
  });
});
