import { describe, expect, test } from "bun:test";
import { PLAYLIST_PAGE, localPlaylistId, localPlaylistNumber, playlistPage } from "./playlists";

describe("the id a client is given for one of our playlists", () => {
  /*
   * The prefix is the whole reason a playlist opens rather than opening empty:
   * Yattee sends its session to the account route for an id starting with
   * `IVPL` and asks the public one for anything else, and only the account
   * route knows about a playlist that belongs to a profile.
   */
  test("says it belongs to an account", () => {
    expect(localPlaylistId(7).startsWith("IVPL")).toBe(true);
  });

  test("comes back as the playlist it names", () => {
    expect(localPlaylistNumber(localPlaylistId(7))).toBe(7);
    expect(localPlaylistNumber(localPlaylistId(12345))).toBe(12345);
  });

  test("is still read when a client saved the one minted before it", () => {
    expect(localPlaylistNumber("ytz7")).toBe(7);
  });

  test("is nothing when the id is somebody else's", () => {
    expect(localPlaylistNumber("PLabcdef")).toBeNull();
    expect(localPlaylistNumber("IVPLdeadbeef")).toBeNull();
    expect(localPlaylistNumber("IVPLytz")).toBeNull();
    expect(localPlaylistNumber("IVPLytz1x")).toBeNull();
    expect(localPlaylistNumber("IVPLytz0")).toBeNull();
    expect(localPlaylistNumber("ytz-1")).toBeNull();
  });
});

describe("how much of a playlist one answer carries", () => {
  test("is the page asked for, and the first one otherwise", () => {
    expect(playlistPage("2")).toBe(2);
    expect(playlistPage(undefined)).toBe(1);
    expect(playlistPage("0")).toBe(1);
    expect(playlistPage("-3")).toBe(1);
    expect(playlistPage("all")).toBe(1);
  });

  // A client pages until an answer is empty — up to fifty in a row. Honouring
  // the page is what makes the second answer the last one.
  test("is a hundred videos, the way Invidious pages them", () => {
    expect(PLAYLIST_PAGE).toBe(100);
  });
});
