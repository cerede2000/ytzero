import { describe, expect, test } from "bun:test";
import { orderedPlaylistVideoIds } from "./playlistOrder";

describe("putting a playlist in order", () => {
  test("takes the order it is given", () => {
    expect(orderedPlaylistVideoIds(["c", "a", "b"], ["a", "b", "c"])).toEqual(["c", "a", "b"]);
  });

  test("keeps what the order forgot, after what it named", () => {
    // A video added in another tab while this one was being dragged around is
    // not in the order that arrives. Dropping it would delete somebody's work
    // as a side effect of moving something else.
    expect(orderedPlaylistVideoIds(["c", "a"], ["a", "b", "c", "d"])).toEqual(["c", "a", "b", "d"]);
  });

  test("refuses to add a video the playlist does not hold", () => {
    expect(orderedPlaylistVideoIds(["ghost", "a"], ["a", "b"])).toEqual(["a", "b"]);
  });

  test("counts a repeated video once", () => {
    expect(orderedPlaylistVideoIds(["b", "b", "a"], ["a", "b"])).toEqual(["b", "a"]);
  });

  test("ignores anything that is not an id", () => {
    expect(orderedPlaylistVideoIds([42, null, { video_id: "a" }, "b"], ["a", "b"])).toEqual(["b", "a"]);
  });

  test("an empty order changes nothing", () => {
    expect(orderedPlaylistVideoIds([], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });
});
