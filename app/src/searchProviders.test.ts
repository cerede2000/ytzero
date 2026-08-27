import { describe, expect, test } from "bun:test";
import { isAllowedRemoteImageUrl } from "./imageCachePolicy";
import { providerThumbnailHosts, requestedProviders, searchProvider, SEARCH_PROVIDERS } from "./searchProviderCatalog";
import { searchDailymotionAll } from "./dailymotion";
import { durationClock, providerCeiling } from "./searchProviders";
import { walkKey } from "./youtubeSearch";

describe("the providers a search can reach", () => {
  test("each one says where its cards lead and what may be done with them", () => {
    for (const provider of SEARCH_PROVIDERS) {
      expect(provider.watchPath).toContain(":id");
      expect(provider.thumbnailHosts.length).toBeGreaterThan(0);
    }
  });

  test("a provider with no rows here may not be offered library actions", () => {
    // Its ids are not in that space. Offered a download, the card would ask
    // about whatever YouTube video happens to share the string.
    expect(searchProvider("dailymotion")?.capabilities.library).toBe(false);
    expect(searchProvider("youtube")?.capabilities.library).toBe(true);
  });

  test("asking for nothing asks for all of them, and for a name nobody has, none", () => {
    expect(requestedProviders(null).map((provider) => provider.id)).toEqual(SEARCH_PROVIDERS.map((p) => p.id));
    expect(requestedProviders("dailymotion").map((provider) => provider.id)).toEqual(["dailymotion"]);
    expect(requestedProviders("dailymotion, youtube")).toHaveLength(2);
    expect(requestedProviders("myspace")).toHaveLength(0);
  });
});

describe("the images the proxy will fetch", () => {
  test("every provider's own hosts, because a refused one is a page of holes", () => {
    // The Dailymotion cards bypassed the proxy with a plain <img> for exactly
    // this reason: the list was written beside the providers instead of by them.
    expect(isAllowedRemoteImageUrl("https://s2.dmcdn.net/v/x/x360.jpg")).toBe(true);
    expect(isAllowedRemoteImageUrl("https://i.ytimg.com/vi/x/hqdefault.jpg")).toBe(true);
    expect(providerThumbnailHosts()).toContain("dmcdn.net");
  });

  test("and nothing that merely looks like one", () => {
    expect(isAllowedRemoteImageUrl("https://dmcdn.net.evil.example/x.jpg")).toBe(false);
    expect(isAllowedRemoteImageUrl("http://s2.dmcdn.net/x.jpg")).toBe(false);
  });
});

describe("whose search a walk belongs to", () => {
  test("two readers never share one, and neither shares the anonymous one", () => {
    // A signed-in search is ranked for that account. Answering another reader
    // from it would hand one person's viewing habits to the next.
    expect(walkKey("chats", 1)).not.toBe(walkKey("chats", 2));
    expect(walkKey("chats", 1)).not.toBe(walkKey("chats", null));
    expect(walkKey("chats", 3)).toBe(walkKey("chats", 3));
  });

  test("and the key holds the reader, never the credential", () => {
    // It is compared, held in memory and may be logged. A cookie in it would
    // be a cookie in all three.
    expect(walkKey("chats", 7, "fr")).toBe("7\u0000fr\u0000chats");
  });
});

describe("what one provider may contribute", () => {
  const answering = (count: number) => (async () => new Response(JSON.stringify({
    list: Array.from({ length: count }, (_, index) => ({
      id: `xaaaa${String(index).padStart(2, "0")}`, title: `Un titre ${index}`, duration: index + 1, allow_embed: true,
    })),
  }), { status: 200 })) as unknown as typeof fetch;

  test("every provider is asked for the same amount", () => {
    // Sixty Dailymotion cards after thirteen YouTube ones read as a broken
    // YouTube search rather than a fuller Dailymotion one, and a filter should
    // narrow what is shown rather than change how much there is.
    expect(providerCeiling()).toBe(40);
  });

  test("and answers with no more than that", async () => {
    const { videos } = await searchDailymotionAll("alpha luna", answering(60), providerCeiling());
    expect(videos).toHaveLength(40);
  });

  test("asked for nothing in particular, it still has its own ceiling", async () => {
    const { videos } = await searchDailymotionAll("alpha luna", answering(80));
    expect(videos).toHaveLength(60);
  });
});

describe("a result described the way every card expects", () => {
  test("seconds become the clock a card prints", () => {
    expect(durationClock(90)).toBe("1:30");
    expect(durationClock(3661)).toBe("1:01:01");
    expect(durationClock(null)).toBe("");
    expect(durationClock(0)).toBe("");
  });
});
