import { describe, expect, test } from "bun:test";
import { audioSourceHeaders } from "./audioSourceResolver";

const PRINTED = JSON.stringify({
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36",
  "Accept-Language": "en-us,en;q=0.5",
  "Sec-Fetch-Mode": "navigate",
});

describe("headers a resolved audio format expects", () => {
  test("keeps who is asking, and nothing else", () => {
    // The rest describes the fetch of a watch page: an HTML accept list and
    // Sec-Fetch-Mode: navigate. On a byte range they describe something that
    // is not happening — and measured, they are the difference between a URL
    // answering 403 and the same URL answering 206.
    expect(audioSourceHeaders(PRINTED)).toEqual({
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36",
    });
  });

  test("drops what belongs to our own request", () => {
    const headers = audioSourceHeaders(JSON.stringify({
      "User-Agent": "yt-dlp",
      Range: "bytes=0-99",
      "Accept-Encoding": "gzip",
      Host: "elsewhere.googlevideo.com",
    }));
    expect(headers).toEqual({ "User-Agent": "yt-dlp" });
  });

  test("says nothing rather than something wrong", () => {
    expect(audioSourceHeaders(undefined)).toBeUndefined();
    expect(audioSourceHeaders("NA")).toBeUndefined();
    expect(audioSourceHeaders("null")).toBeUndefined();
    expect(audioSourceHeaders("{}")).toBeUndefined();
    expect(audioSourceHeaders(JSON.stringify({ "User-Agent": 42 }))).toBeUndefined();
    expect(audioSourceHeaders(JSON.stringify({ "Sec-Fetch-Mode": "navigate" }))).toBeUndefined();
  });
});
