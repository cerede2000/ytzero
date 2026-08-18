import { describe, expect, test } from "bun:test";
import { isAllowedRemoteImageUrl } from "./imageCachePolicy";
import { providerThumbnailHosts, requestedProviders, searchProvider, SEARCH_PROVIDERS } from "./searchProviderCatalog";
import { durationClock } from "./searchProviders";

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

describe("a result described the way every card expects", () => {
  test("seconds become the clock a card prints", () => {
    expect(durationClock(90)).toBe("1:30");
    expect(durationClock(3661)).toBe("1:01:01");
    expect(durationClock(null)).toBe("");
    expect(durationClock(0)).toBe("");
  });
});
