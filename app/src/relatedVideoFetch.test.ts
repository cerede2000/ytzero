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
  asSomebody?: (videoId: string, userId: number) => RelatedVideo[];
} = {}) {
  const saved: Record<string, RelatedVideo[]> = {};
  const stored = { ...(options.stored ?? {}) };
  const asked: Array<number> = [];
  const forgotten: string[] = [];
  let loads = 0;
  const fetch = createRelatedVideoFetcher(
    async (videoId, userId) => stored[`${userId}:${videoId}`] ?? [],
    async (videoId, userId, videos) => { stored[`${userId}:${videoId}`] = [...videos]; saved[`${userId}:${videoId}`] = [...videos]; },
    async (videoId, related) => {
      loads++;
      if (options.fail) options.fail();
      related.videos = options.answer ? options.answer(videoId) : [suggestion(`${videoId}-a`)];
      return {} as never;
    },
    options.clock ?? (() => 1_000),
    async (videoId, userId) => { asked.push(userId); return options.asSomebody ? options.asSomebody(videoId, userId) : []; },
    async (videoId, userId) => { forgotten.push(`${userId}:${videoId}`); delete stored[`${userId}:${videoId}`]; },
  );
  return { fetch, saved, asked, forgotten, loads: () => loads };
}

describe("fetching a panel for a video that never had one", () => {
  test("reads what is stored for this profile rather than asking again", async () => {
    const { fetch, loads } = fetcher({ stored: { "1:abc": [suggestion("kept")] } });
    expect((await fetch("abc", 1)).map((video) => video.videoId)).toEqual(["kept"]);
    expect(loads()).toBe(0);
  });

  test("asks once, and writes the answer down under the profile that asked", async () => {
    const { fetch, saved, loads } = fetcher();
    expect((await fetch("abc", 2)).map((video) => video.videoId)).toEqual(["abc-a"]);
    expect(saved["2:abc"]?.length).toBe(1);
    expect(saved["1:abc"] === undefined).toBe(true);
    expect(loads()).toBe(1);
  });

  test("one profile's panel is not the other's", async () => {
    // A panel is assembled from what an account watches. Keyed on the video
    // alone it was fetched by whoever opened the video first and served to the
    // whole household after — one person's viewing habits, handed to everyone.
    const { fetch, loads } = fetcher({ stored: { "1:shared": [suggestion("mine")] } });
    expect((await fetch("shared", 1)).map((v) => v.videoId)).toEqual(["mine"]);
    expect((await fetch("shared", 2)).map((v) => v.videoId)).toEqual(["shared-a"]);
    expect(loads()).toBe(1);
  });

  test("two pages opening the same video for the same profile share one request", async () => {
    const { fetch, loads } = fetcher();
    const [first, second] = await Promise.all([fetch("both", 1), fetch("both", 1)]);
    expect(first).toEqual(second);
    expect(loads()).toBe(1);
  });

  test("stops asking about a video YouTube gives nothing for", async () => {
    const { fetch, loads } = fetcher({ answer: () => [] });
    expect(await fetch("empty", 1)).toEqual([]);
    expect(await fetch("empty", 1)).toEqual([]);
    expect(loads()).toBe(1);
  });

  test("tries again once the quiet has passed", async () => {
    let clock = 1_000;
    const { fetch, loads } = fetcher({ answer: () => [], clock: () => clock });
    await fetch("later", 1);
    clock += 7 * 60 * 60_000;
    await fetch("later", 1);
    expect(loads()).toBe(2);
  });
});

describe("asking again on purpose", () => {
  test("drops what was stored and fetches a fresh panel", async () => {
    const { fetch, forgotten, loads } = fetcher({ stored: { "1:abc": [suggestion("stale")] } });
    expect((await fetch("abc", 1)).map((v) => v.videoId)).toEqual(["stale"]);
    expect((await fetch("abc", 1, true)).map((v) => v.videoId)).toEqual(["abc-a"]);
    expect(forgotten).toEqual(["1:abc"]);
    expect(loads()).toBe(1);
  });

  test("asks even for a video YouTube gave nothing for a moment ago", async () => {
    const { fetch, loads } = fetcher({ answer: () => [] });
    await fetch("nothing-here", 1);
    await fetch("nothing-here", 1, true);
    expect(loads()).toBe(2);
  });
});

describe("whose panel it is", () => {
  test("a profile with no account still gets the panel about the video", async () => {
    const { fetch, loads } = fetcher();
    expect((await fetch("anon", 3)).map((v) => v.videoId)).toEqual(["anon-a"]);
    expect(loads()).toBe(1);
  });
});

describe("when YouTube is refusing the address", () => {
  test("asks as the profile looking at the video, and only as them", async () => {
    const { fetch, saved, asked } = fetcher({
      fail: () => { throw new YouTubeRefusingError(); },
      asSomebody: (videoId, userId) => userId === 2 ? [suggestion(`${videoId}-signed-in`)] : [],
    });
    expect((await fetch("refused", 2)).map((video) => video.videoId)).toEqual(["refused-signed-in"]);
    expect(saved["2:refused"]?.length).toBe(1);
    expect(asked).toEqual([2]);
  });

  test("a profile with no jar of its own gets no panel, not somebody else's", async () => {
    // Metadata may be fetched with a borrowed jar — a title is the video's,
    // not the account's. Suggestions are the opposite, and lending them hands
    // one person's viewing habits to another.
    const { fetch, saved, asked } = fetcher({
      fail: () => { throw new YouTubeRefusingError(); },
      asSomebody: (_videoId, userId) => userId === 1 ? [suggestion("profile-one")] : [],
    });
    expect(await fetch("lent-nothing", 2)).toEqual([]);
    expect(saved["2:lent-nothing"] === undefined).toBe(true);
    expect(asked).toEqual([2]);
  });

  test("recognises the refusal that opens a cycle, which arrives as a plain failure", async () => {
    // Only the second refusal and after are the sentinel class; the first is
    // what three real attempts came back with. Read as an ordinary failure it
    // would be remembered as "this video has no panel", for six hours.
    const refused = new Error("video info failed: html=videoDetails missing (LOGIN_REQUIRED: Sign in to confirm you’re not a bot); innertube=HTTP error! status: 400");
    const { fetch, loads } = fetcher({ fail: () => { throw refused; } });
    expect(await fetch("plain-refusal", 1)).toEqual([]);
    expect(await fetch("plain-refusal", 1)).toEqual([]);
    expect(loads()).toBe(2);
  });

  test("does not hold the video shut for six hours over a ninety-second refusal", async () => {
    const { fetch, loads } = fetcher({ fail: () => { throw new YouTubeRefusingError(); } });
    expect(await fetch("still-refused", 1)).toEqual([]);
    expect(await fetch("still-refused", 1)).toEqual([]);
    expect(loads()).toBe(2);
  });
});

describe("a video with no library row", () => {
  test("is asked about once, not once per ask", async () => {
    // A panel is stored against the video's row, and a video opened from
    // somebody else's panel has none until its import finishes — or ever, if
    // the import fails. Every ask found nothing stored and bought another
    // request: three signed-in fetches of the same page in twelve seconds, on
    // an address that was already being refused.
    let signedInFetches = 0;
    const fetch = createRelatedVideoFetcher(
      async () => [],
      async () => { /* the row is missing, so nothing can be written */ },
      async () => { throw new Error("the anonymous path is not reached here"); },
      () => 1_000,
      async (videoId) => { signedInFetches++; return [suggestion(`${videoId}-mine`)]; },
      async () => {},
    );
    expect((await fetch("no-row", 1, false, "account")).map((v) => v.videoId)).toEqual(["no-row-mine"]);
    expect((await fetch("no-row", 1, false, "account")).map((v) => v.videoId)).toEqual(["no-row-mine"]);
    expect(signedInFetches).toBe(1);
  });
});

describe("being known, rather than merely presenting a jar", () => {
  test("the log records the answer, not the attempt", async () => {
    // An expired or rotated jar is answered with the page a stranger gets:
    // parseable, twenty suggestions, and about nobody. Reporting
    // "credentialed" for the attempt made rather than the answer received is
    // how a dead jar looks like a working one for a morning.
    let told: { signedIn: boolean } | undefined;
    const fetch = createRelatedVideoFetcher(
      async () => [],
      async () => {},
      async () => { throw new Error("not reached"); },
      () => 1_000,
      async (videoId, _userId, recognised) => { told = recognised; return [suggestion(`${videoId}-a`)]; },
      async () => {},
    );
    await fetch("asked-as-somebody", 9, false, "account");
    expect(told !== undefined).toBe(true);
    expect(told?.signedIn).toBe(false);
  });
});

describe("whose question the panel answers", () => {
  function asking(source: "video" | "personal" | "account") {
    const asked: string[] = [];
    return {
      asked,
      fetch: createRelatedVideoFetcher(
        async () => [],
        async () => {},
        async (videoId, related) => { asked.push("anonymous"); related.videos = [suggestion(`${videoId}-about-the-video`)]; return {} as never; },
        () => 1_000,
        async (videoId) => { asked.push("account"); return [suggestion(`${videoId}-about-me`)]; },
        async () => {},
      ),
      source,
    };
  }

  test("about the video by default, which is what a panel beside a video is for", async () => {
    // Measured on two unrelated videos: asked as nobody, a documentary on IMAX
    // is answered with two more on IMAX. Asked as an account, the same list
    // comes back whichever video was opened.
    const { fetch, asked, source } = asking("video");
    expect((await fetch("v1", 1, false, source)).map((v) => v.videoId)).toEqual(["v1-about-the-video"]);
    expect(asked).toEqual(["anonymous"]);
  });

  test("about the account when the reader says so", async () => {
    const { fetch, asked, source } = asking("account");
    expect((await fetch("v2", 1, false, source)).map((v) => v.videoId)).toEqual(["v2-about-me"]);
    expect(asked).toEqual(["account"]);
  });
});

describe("the panel youtube.com itself shows", () => {
  test("asks YouTube's own endpoint, not the page", async () => {
    // Reading the page signed in gives a panel that leans towards the feed;
    // reading it anonymously gives the video's own and knows nothing of the
    // reader. Neither is what a browser shows, which is both at once — and a
    // browser gets it by calling the endpoint rather than reading the page.
    const asked: string[] = [];
    const fetch = createRelatedVideoFetcher(
      async () => [],
      async () => {},
      async (videoId, related) => { asked.push("page:anonymous"); related.videos = [suggestion(`${videoId}-anon`)]; return {} as never; },
      () => 1_000,
      async (videoId) => { asked.push("page:account"); return [suggestion(`${videoId}-feed`)]; },
      async () => {},
      async (videoId) => { asked.push("endpoint"); return [suggestion(`${videoId}-mine-and-the-video`)]; },
    );
    expect((await fetch("v3", 1, false, "personal")).map((v) => v.videoId)).toEqual(["v3-mine-and-the-video"]);
    expect(asked).toEqual(["endpoint"]);
  });

  test("falls back to the video's own panel when the endpoint says nothing", async () => {
    const fetch = createRelatedVideoFetcher(
      async () => [],
      async () => {},
      async (videoId, related) => { related.videos = [suggestion(`${videoId}-anon`)]; return {} as never; },
      () => 1_000,
      async () => [],
      async () => {},
      async () => { throw new Error("the endpoint refused"); },
    );
    expect((await fetch("v4", 1, false, "personal")).map((v) => v.videoId)).toEqual(["v4-anon"]);
  });
});
