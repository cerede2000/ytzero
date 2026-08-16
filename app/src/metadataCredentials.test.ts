import { describe, expect, test } from "bun:test";
import { askWithBorrowedCredentials, AUTHENTICATED_LOOKUPS_PER_BATCH, fetchVideoInfoAsProfile, lookupBudget } from "./metadataCredentials";
import type { VideoInfo } from "./youtube";

const info = (videoId: string) => ({ videoId, title: "A video", channelId: "UC1" }) as VideoInfo;

describe("asking again as somebody", () => {
  test("uses the profile that has a cookie jar", async () => {
    const asked: Array<{ userId: number; videoId: string }> = [];
    const found = await fetchVideoInfoAsProfile(
      "abc",
      lookupBudget(),
      async (userId, videoId) => { asked.push({ userId, videoId }); return info(videoId); },
      async () => 2,
    );
    expect(found?.videoId).toBe("abc");
    expect(asked).toEqual([{ userId: 2, videoId: "abc" }]);
  });

  test("does nothing when no profile has one", async () => {
    // Without credentials there is no second question to put: the anonymous
    // attempt was the only one available, and it was refused.
    let asks = 0;
    const found = await fetchVideoInfoAsProfile("abc", lookupBudget(), async () => { asks++; return info("abc"); }, async () => null);
    expect(found).toBeNull();
    expect(asks).toBe(0);
  });

  test("spends a bounded number of lookups per batch", async () => {
    // yt-dlp costs about five seconds against one for a plain request, so a
    // batch of twenty falling back entirely would hold the runtime for two
    // minutes. The rest wait for the next batch, as they did before.
    const budget = lookupBudget();
    let asks = 0;
    for (let attempt = 0; attempt < 10; attempt++) {
      await fetchVideoInfoAsProfile("abc", budget, async () => { asks++; return info("abc"); }, async () => 1);
    }
    expect(asks).toBe(AUTHENTICATED_LOOKUPS_PER_BATCH);
    expect(budget.remaining).toBe(0);
  });

  test("spends the budget on a failure too, rather than retrying its way through it", async () => {
    const budget = lookupBudget(1);
    expect(await fetchVideoInfoAsProfile("abc", budget, async () => null, async () => 1)).toBeNull();
    expect(budget.remaining).toBe(0);
  });

  test("hands back nothing rather than throwing when yt-dlp fails", async () => {
    const found = await fetchVideoInfoAsProfile(
      "abc",
      lookupBudget(),
      async () => { throw new Error("yt-dlp exploded"); },
      async () => 1,
    );
    expect(found).toBeNull();
  });
});

describe("borrowing credentials to open a video", () => {
  test("asks as the profile itself, and stops there when that works", async () => {
    const asked: number[] = [];
    const found = await askWithBorrowedCredentials(2, async (id) => { asked.push(id); return info("abc"); }, async () => 1);
    expect(found?.videoId).toBe("abc");
    expect(asked).toEqual([2]);
  });

  test("asks again as the lender when the profile has nothing to ask with", async () => {
    // A profile with no cookie jar makes one anonymous attempt, is refused in
    // two seconds, and the video will not open — while the same video opens
    // for the profile next door. That is not a decision anybody made.
    const asked: number[] = [];
    const borrowed: number[] = [];
    const found = await askWithBorrowedCredentials(
      2,
      async (id) => { asked.push(id); return id === 1 ? info("abc") : null; },
      async () => 1,
      (lender) => borrowed.push(lender),
    );
    expect(found?.videoId).toBe("abc");
    expect(asked).toEqual([2, 1]);
    expect(borrowed).toEqual([1]);
  });

  test("does not ask the same profile twice when it is its own lender", async () => {
    const asked: number[] = [];
    expect(await askWithBorrowedCredentials(1, async (id) => { asked.push(id); return null; }, async () => 1)).toBe(null);
    expect(asked).toEqual([1]);
  });

  test("gives up when no profile has a jar to lend", async () => {
    const asked: number[] = [];
    expect(await askWithBorrowedCredentials(2, async (id) => { asked.push(id); return null; }, async () => null)).toBe(null);
    expect(asked).toEqual([2]);
  });
});
