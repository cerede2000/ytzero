import { describe, expect, test } from "bun:test";
import { fetchWatchNextPanel, sapisidFrom, sapisidHash } from "./youtubeInnerTube";

describe("signing the call the way a browser does", () => {
  test("the hash is the timestamp, the account cookie and the origin, in that order", () => {
    // YouTube answers as the account only when the request proves it holds the
    // cookie, rather than merely sending it.
    const seen: string[] = [];
    const header = sapisidHash("SECRET", "https://www.youtube.com", 1_700_000_000_000, (value) => { seen.push(value); return "d1ge5t"; });
    expect(seen).toEqual(["1700000000 SECRET https://www.youtube.com"]);
    expect(header).toBe("SAPISIDHASH 1700000000_d1ge5t");
  });

  test("finds the account cookie under whichever of its names is present", () => {
    expect(sapisidFrom("SID=a; SAPISID=plain; HSID=b")).toBe("plain");
    expect(sapisidFrom("SID=a; __Secure-3PAPISID=third")).toBe("third");
    expect(sapisidFrom("SID=a; HSID=b")).toBe(null);
  });
});

describe("asking for the panel as the account", () => {
  const panel = {
    contents: {
      twoColumnWatchNextResults: {
        secondaryResults: {
          secondaryResults: {
            results: [{
              lockupViewModel: {
                contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
                contentId: "abc12345678",
                metadata: { lockupMetadataViewModel: { title: { content: "Une vidéo" }, metadata: { contentMetadataViewModel: { metadataRows: [
                  { metadataParts: [{ text: { content: "Une chaîne" } }] },
                  { metadataParts: [{ text: { content: "699 k" } }, { text: { content: "il y a 2 sem." } }] },
                ] } } } },
              },
            }],
          },
        },
      },
    },
  };

  test("reads the answer with the same parser as the page, because it is the same shape", async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const videos = await fetchWatchNextPanel(
      "watched01234",
      "SAPISID=secret; SID=abc",
      "fr",
      () => 1_700_000_000_000,
      (async (url: string, init: RequestInit) => {
        sent = { url, init };
        return new Response(JSON.stringify(panel), { status: 200 });
      }) as unknown as typeof fetch,
    );
    expect(videos.map((video) => video.videoId)).toEqual(["abc12345678"]);
    // Parsed in the language it was asked in: "699 k" and "il y a 2 sem." are
    // not English, and read as English they would become the channel's name.
    expect(videos[0]?.channelTitle).toBe("Une chaîne");
    expect(videos[0]?.viewCount).toBe(699_000);
    expect(videos[0]?.published).toEqual({ value: 2, unit: "week" });
    expect(String((sent as any).init.headers.Authorization).startsWith("SAPISIDHASH 1700000000_")).toBe(true);
  });

  test("says nothing when the jar carries no account", async () => {
    let asked = false;
    const videos = await fetchWatchNextPanel(
      "watched01234",
      "CONSENT=YES",
      "en",
      () => 1,
      (async () => { asked = true; return new Response("{}"); }) as unknown as typeof fetch,
    );
    expect(videos).toEqual([]);
    expect(asked).toBe(false);
  });
});
