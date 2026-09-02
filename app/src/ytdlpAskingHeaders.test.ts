import { describe, expect, test } from "bun:test";
import { parseYtdlpHttpHeaders } from "./ytdlpHttpHeaders";
import { askingHeadersOnly } from "./ytdlpAskingHeaders";

const PRINTED = JSON.stringify({
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36",
  "Accept-Language": "en-us,en;q=0.5",
  "Sec-Fetch-Mode": "navigate",
});

describe("headers a resolved format is asked with", () => {
  test("keeps who is asking, and nothing else", () => {
    // The rest describes the fetch of a watch page: an HTML accept list and
    // Sec-Fetch-Mode: navigate. On a byte range they describe something that
    // is not happening — and measured, they are the difference between a URL
    // answering 403 and the same URL answering 206.
    expect(askingHeadersOnly(parseYtdlpHttpHeaders(PRINTED))).toEqual({
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36",
    });
  });

  test("drops what belongs to our own request", () => {
    const headers = askingHeadersOnly(parseYtdlpHttpHeaders(JSON.stringify({
      "User-Agent": "yt-dlp",
      "Accept-Encoding": "gzip",
    })));
    expect(headers).toEqual({ "User-Agent": "yt-dlp" });
  });

  test("says nothing rather than something wrong", () => {
    expect(askingHeadersOnly(null)).toBeNull();
    expect(askingHeadersOnly(parseYtdlpHttpHeaders("NA"))).toBeNull();
    expect(askingHeadersOnly(parseYtdlpHttpHeaders("null"))).toBeNull();
    expect(askingHeadersOnly(parseYtdlpHttpHeaders("{}"))).toBeNull();
    expect(askingHeadersOnly(parseYtdlpHttpHeaders(JSON.stringify({ "Sec-Fetch-Mode": "navigate" })))).toBeNull();
  });
});
