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
  asSomebody?: (videoId: string, userId: number | undefined) => RelatedVideo[];
} = {}) {
  const saved: Record<string, RelatedVideo[]> = {};
  const stored = options.stored ?? {};
  const asked: Array<number | undefined> = [];
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
    async (videoId, userId) => { asked.push(userId); return options.asSomebody ? options.asSomebody(videoId, userId) : []; },
  );
  return { fetch, saved, asked, loads: () => loads };
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
});

describe("when YouTube is refusing the address", () => {
  test("asks again as the profile looking at the video", async () => {
    // The refusal is what the anonymous request gets; the cookie jar on disk
    // is the thing that still gets an answer, and only the watch page carries
    // a panel at all — yt-dlp cannot stand in for it here.
    const { fetch, saved, asked } = fetcher({
      fail: () => { throw new YouTubeRefusingError(); },
      asSomebody: (videoId) => [suggestion(`${videoId}-signed-in`)],
    });
    expect((await fetch("refused", 2)).map((video) => video.videoId)).toEqual(["refused-signed-in"]);
    expect(saved.refused?.length).toBe(1);
    expect(asked).toEqual([2]);
  });

  test("does not hold the video shut for six hours over a ninety-second refusal", async () => {
    // A refusal answers nothing about this video: the question was never put.
    // Remembering it as empty is what left a panel local for the rest of the
    // evening after one bad minute.
    const { fetch, loads } = fetcher({ fail: () => { throw new YouTubeRefusingError(); } });
    expect(await fetch("still-refused")).toEqual([]);
    expect(await fetch("still-refused")).toEqual([]);
    expect(loads()).toBe(2);
  });

  test("recognises the first refusal, which arrives as a plain failure", async () => {
    // Only the second refusal and after are YouTubeRefusingError: the first is
    // what three real attempts came back with. Reading just the class sent the
    // video that opened the cycle down the "no panel here" branch — logged as
    // a fetch failure, remembered for six hours, and never asked with cookies.
    const refused = new Error("video info failed: html=videoDetails missing (LOGIN_REQUIRED: Sign in to confirm you’re not a bot); innertube=HTTP error! status: 400; embed=videoDetails missing (no player response)");
    const { fetch, saved } = fetcher({
      fail: () => { throw refused; },
      asSomebody: (videoId) => [suggestion(`${videoId}-signed-in`)],
    });
    expect((await fetch("first-of-the-cycle", 2)).map((video) => video.videoId)).toEqual(["first-of-the-cycle-signed-in"]);
    expect(saved["first-of-the-cycle"]?.length).toBe(1);
  });

  test("gives up quietly when no profile has a cookie jar", async () => {
    const { fetch, saved } = fetcher({ fail: () => { throw new YouTubeRefusingError(); } });
    expect(await fetch("nobody")).toEqual([]);
    expect(saved.nobody === undefined).toBe(true);
  });

  test("survives a signed-in attempt that fails too", async () => {
    const { fetch } = fetcher({
      fail: () => { throw new YouTubeRefusingError(); },
      asSomebody: () => { throw new Error("refused again"); },
    });
    expect(await fetch("both-refused")).toEqual([]);
  });
});
