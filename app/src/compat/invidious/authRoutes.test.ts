import { describe, expect, test } from "bun:test";
import { feedSize } from "./authRoutes";
import { looksLikeToken, sidFrom } from "./tokens";

describe("the session a client sends back", () => {
  test("is read out of the cookie it was set in", () => {
    expect(sidFrom("SID=ytz_abc")).toBe("ytz_abc");
    expect(sidFrom("other=1; SID=ytz_abc; more=2")).toBe("ytz_abc");
  });

  test("is nothing when no session was sent", () => {
    expect(sidFrom(undefined)).toBeNull();
    expect(sidFrom("other=1")).toBeNull();
    // A cookie whose name merely ends in SID belongs to somebody else.
    expect(sidFrom("MYSID=stolen")).toBeNull();
  });
});

describe("what counts as a token", () => {
  test("is the shape this server mints, and only that", () => {
    expect(looksLikeToken("ytz_" + "a".repeat(64))).toBe(true);
    expect(looksLikeToken("ytz_" + "a".repeat(63))).toBe(false);
    expect(looksLikeToken("ytz_" + "A".repeat(64))).toBe(false);
    expect(looksLikeToken("other_" + "a".repeat(64))).toBe(false);
    expect(looksLikeToken(undefined)).toBe(false);
    expect(looksLikeToken("")).toBe(false);
  });
});

describe("how much feed a client may ask for", () => {
  test("is what it asked, within reason", () => {
    expect(feedSize("20")).toBe(20);
    expect(feedSize("500")).toBe(200);
  });

  test("is a sensible page when it asked for nothing sensible", () => {
    expect(feedSize(undefined)).toBe(60);
    expect(feedSize("0")).toBe(60);
    expect(feedSize("-5")).toBe(60);
    expect(feedSize("all of it")).toBe(60);
  });
});
