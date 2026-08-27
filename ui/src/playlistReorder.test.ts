import { describe, expect, test } from "bun:test";
import { movedItem } from "./playlistReorder";

const list = ["a", "b", "c", "d"];

describe("carrying one entry to another place", () => {
  test("moves it down, closing the gap behind it", () => {
    expect(movedItem(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  test("moves it up", () => {
    expect(movedItem(list, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  test("to the same place is the same list", () => {
    expect(movedItem(list, 2, 2)).toEqual(list);
  });

  test("clamps a target past either end rather than losing the entry", () => {
    expect(movedItem(list, 1, 99)).toEqual(["a", "c", "d", "b"]);
    expect(movedItem(list, 2, -5)).toEqual(["c", "a", "b", "d"]);
  });

  test("leaves the list alone when asked to move something that is not in it", () => {
    expect(movedItem(list, 9, 0)).toEqual(list);
    expect(movedItem(list, -1, 0)).toEqual(list);
  });

  test("never changes the list it was given", () => {
    const original = [...list];
    movedItem(list, 0, 3);
    expect(list).toEqual(original);
  });
});
