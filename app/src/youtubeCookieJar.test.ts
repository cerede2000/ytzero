import { describe, expect, test } from "bun:test";
import { mergeSetCookies } from "./youtubeCookieJar";

const NOW = Date.parse("2026-08-17T10:00:00Z");
const line = (name: string, value: string, expires = "1893456000", domain = ".youtube.com") =>
  [domain, "TRUE", "/", "TRUE", expires, name, value].join("\t");
const jar = (...lines: string[]) => ["# Netscape HTTP Cookie File", ...lines, ""].join("\n");

describe("keeping the jar current the way a browser does", () => {
  test("a rotated value replaces the one on disk", () => {
    // YouTube hands back new values as you browse and expects the next request
    // to carry them. A file exported once drifts behind until it is no longer
    // recognised — the account is fine, the export is stale.
    const merged = mergeSetCookies(jar(line("SID", "old")), ["SID=new; Domain=.youtube.com; Path=/; Secure"], NOW);
    expect(merged?.includes("\tSID\tnew")).toBe(true);
    expect(merged?.includes("\tSID\told")).toBe(false);
  });

  test("a value that did not change rewrites nothing", () => {
    expect(mergeSetCookies(jar(line("SID", "same")), ["SID=same; Domain=.youtube.com; Path=/; Secure"], NOW)).toBe(null);
    expect(mergeSetCookies(jar(line("SID", "same")), [], NOW)).toBe(null);
  });

  test("a new cookie is added, an expired one is dropped", () => {
    const added = mergeSetCookies(jar(line("SID", "abc")), ["__Secure-1PSID=xyz; Domain=.youtube.com; Path=/; Secure"], NOW);
    expect(added?.includes("__Secure-1PSID\txyz")).toBe(true);

    const removed = mergeSetCookies(jar(line("SID", "abc"), line("DROPME", "v")), ["DROPME=; Max-Age=0; Domain=.youtube.com"], NOW);
    expect(removed?.includes("DROPME")).toBe(false);
    expect(removed?.includes("\tSID\tabc")).toBe(true);
  });

  test("nothing but YouTube is ever written down", () => {
    // A redirect through another host has no business adding to a jar that
    // exists to talk to YouTube.
    expect(mergeSetCookies(jar(line("SID", "abc")), ["NID=tracking; Domain=.google.com; Path=/"], NOW)).toBe(null);
  });

  test("a host-only cookie keeps the prefix yt-dlp wrote it with", () => {
    const contents = jar(`#HttpOnly_${line("__Secure-3PSID", "old")}`);
    const merged = mergeSetCookies(contents, ["__Secure-3PSID=new; Domain=.youtube.com; Path=/; Secure; HttpOnly"], NOW);
    expect(merged?.includes("#HttpOnly_.youtube.com")).toBe(true);
    expect(merged?.includes("\t__Secure-3PSID\tnew")).toBe(true);
  });

  test("the file stays a Netscape jar, header and all", () => {
    const merged = mergeSetCookies(jar(line("SID", "old")), ["SID=new; Domain=.youtube.com"], NOW);
    expect(merged?.startsWith("# Netscape HTTP Cookie File\n")).toBe(true);
    expect(merged?.endsWith("\n")).toBe(true);
    expect(merged?.split("\n").filter((l) => l && !l.startsWith("#")).length).toBe(1);
  });

  test("an unnamed domain follows the cookie already on file", () => {
    // Set-Cookie may omit Domain, meaning "the host that answered". The jar
    // already knows which that was.
    const merged = mergeSetCookies(jar(line("SID", "old")), ["SID=new; Path=/"], NOW);
    expect(merged?.includes("\tSID\tnew")).toBe(true);
  });
});
