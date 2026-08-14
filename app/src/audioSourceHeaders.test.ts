import { describe, expect, test } from "bun:test";
import { audioSourceHeaders } from "./audioSourceResolver";

const PRINTED = JSON.stringify({
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36",
  "Accept-Language": "en-us,en;q=0.5",
  "Sec-Fetch-Mode": "navigate",
});

describe("headers a resolved audio format expects", () => {
  test("keeps what identifies the caller", () => {
    const headers = audioSourceHeaders(PRINTED);
    expect(headers?.["User-Agent"]).toContain("Chrome/149.0.0.0");
    expect(headers?.["Sec-Fetch-Mode"]).toBe("navigate");
  });

  test("drops what belongs to our own request", () => {
    // The range is ours to decide, and an encoding we did not ask for would
    // arrive as bytes we cannot count.
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
  });
});
