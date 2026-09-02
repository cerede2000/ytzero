import { describe, expect, test } from "bun:test";
import { filterPlaylistsByName, movePlaylistSearchIndex, normalizePlaylistSearch } from "./playlistSearch";

describe("playlist search", () => {
  test("normalizes whitespace, case, and diacritics", () => {
    expect(normalizePlaylistSearch("  ŻÓŁĆ  ")).toBe("zolc");
  });

  test("filters by a partial playlist name while preserving order", () => {
    const playlists = [{ name: "Coding talks" }, { name: "Music" }, { name: "Code reviews" }];
    expect(filterPlaylistsByName(playlists, "cod")).toEqual([playlists[0], playlists[2]]);
    expect(filterPlaylistsByName(playlists, "  ")).toEqual(playlists);
  });

  test("moves through results in both directions and wraps at the edges", () => {
    expect(movePlaylistSearchIndex(-1, 3, "next")).toBe(0);
    expect(movePlaylistSearchIndex(-1, 3, "previous")).toBe(2);
    expect(movePlaylistSearchIndex(2, 3, "next")).toBe(0);
    expect(movePlaylistSearchIndex(0, 3, "previous")).toBe(2);
    expect(movePlaylistSearchIndex(0, 0, "next")).toBe(-1);
  });
});
