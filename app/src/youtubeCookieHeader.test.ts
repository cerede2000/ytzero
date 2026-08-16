import { describe, expect, test } from "bun:test";
import { parseYoutubeCookieHeader } from "./youtubeCookieHeader";

const jar = (...lines: string[]) => ["# Netscape HTTP Cookie File", ...lines].join("\n");
const line = (domain: string, name: string, value: string) =>
  [domain, "TRUE", "/", "TRUE", "1893456000", name, value].join("\t");

describe("reading a cookie jar as a header", () => {
  test("writes the pairs the way a browser sends them", () => {
    expect(parseYoutubeCookieHeader(jar(line(".youtube.com", "SID", "abc"), line(".youtube.com", "HSID", "def"))))
      .toBe("SID=abc; HSID=def");
  });

  test("keeps only youtube.com", () => {
    // A jar exported from a browser carries whatever else was open at the
    // time, and none of it belongs in a request to YouTube.
    expect(parseYoutubeCookieHeader(jar(
      line(".google.com", "NID", "elsewhere"),
      line(".mail.example", "SESSION", "private"),
      line(".youtube.com", "SID", "abc"),
    ))).toBe("SID=abc");
  });

  test("reads the host-only cookies yt-dlp marks as comments", () => {
    expect(parseYoutubeCookieHeader(jar(`#HttpOnly_${line(".youtube.com", "SID", "abc")}`))).toBe("SID=abc");
  });

  test("survives comments, blank lines and carriage returns", () => {
    expect(parseYoutubeCookieHeader(`# Netscape HTTP Cookie File\r\n\r\n# a note\r\n${line("youtube.com", "SID", "abc")}\r\n`))
      .toBe("SID=abc");
  });

  test("says nothing rather than an empty header", () => {
    expect(parseYoutubeCookieHeader(jar(line(".google.com", "NID", "elsewhere")))).toBe(null);
    expect(parseYoutubeCookieHeader("")).toBe(null);
  });

  test("ignores a truncated line rather than sending half a cookie", () => {
    expect(parseYoutubeCookieHeader(jar(".youtube.com\tTRUE\t/\tTRUE\t1893456000\tSID"))).toBe(null);
  });
});
