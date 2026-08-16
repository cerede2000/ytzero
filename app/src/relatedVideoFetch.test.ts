import { describe, expect, test } from "bun:test";
import { createRelatedVideoFetcher } from "./relatedVideoFetch";
import type { RelatedVideo } from "./relatedVideos";
import { YouTubeRefusingError } from "./youtubeRefusalQuiet";

const suggestion = (videoId: string) => ({ videoId, title: videoId }) as RelatedVideo;

function fetcher(options: {
  stored?: Record<string, RelatedVideo[]>;
  answer?: (videoId: string) => RelatedVideo[];
  fail?: () => never;
  clock?: () => number;
} = {}) {
  const saved: Record<string, RelatedVideo[]> = {};
  const stored = options.stored ?? {};
  let loads = 0;
  const fetch = createRelatedVideoFetcher(
    async (videoId) => stored[videoId] ?? [],
    async (videoId, videos) => { saved[videoId] = [...videos]; },
    async (videoId, related) => {
      loads++;
      if (options.fail) options.fail();
      related.videos = options.answer ? options.answer(videoId) : [suggestion(`${videoId}-a`)];
      return {} as never;
    },
    options.clock ?? (() => 1_000),
  );
  return { fetch, saved, loads: () => loads };
}

describe("fetching a panel for a video that never had one", () => {
  test("reads what is stored rather than asking again", async () => {
    const { fetch, loads } = fetcher({ stored: { abc: [suggestion("kept")] } });
    expect((await fetch("abc")).map((video) => video.videoId)).toEqual(["kept"]);
    expect(loads()).toBe(0);
  });

  test("asks once, and writes the answer down", async () => {
    const { fetch, saved, loads } = fetcher();
    expect((await fetch("abc")).map((video) => video.videoId)).toEqual(["abc-a"]);
    expect(saved.abc?.length).toBe(1);
    expect(loads()).toBe(1);
  });

  test("two pages opening the same video share one request", async () => {
    const { fetch, loads } = fetcher();
    const [first, second] = await Promise.all([fetch("shared"), fetch("shared")]);
    expect(first).toEqual(second);
    expect(loads()).toBe(1);
  });

  test("stops asking about a video YouTube gives nothing for", async () => {
    // Not every video has a panel, and the ones that do not would otherwise
    // buy a request on every single open, for ever.
    const { fetch, loads } = fetcher({ answer: () => [] });
    expect(await fetch("empty")).toEqual([]);
    expect(await fetch("empty")).toEqual([]);
    expect(loads()).toBe(1);
  });

  test("tries again once the quiet has passed", async () => {
    let clock = 1_000;
    const { fetch, loads } = fetcher({ answer: () => [], clock: () => clock });
    await fetch("later");
    clock += 7 * 60 * 60_000;
    await fetch("later");
    expect(loads()).toBe(2);
  });

  test("says nothing, and stays quiet, when the address is being refused", async () => {
    const { fetch, loads } = fetcher({ fail: () => { throw new YouTubeRefusingError(); } });
    expect(await fetch("refused")).toEqual([]);
    expect(await fetch("refused")).toEqual([]);
    expect(loads()).toBe(1);
  });
});
