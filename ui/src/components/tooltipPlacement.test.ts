import { describe, expect, test } from "bun:test";
import { clampedOffset } from "./tooltipPlacement";

const screen = { width: 1000, height: 800 };
const box = (left: number, right: number, top = 100, bottom = 120) => ({ left, right, top, bottom });

describe("keeping a tooltip on screen", () => {
  test("leaves one that already fits exactly where it is", () => {
    expect(clampedOffset(box(400, 600), screen)).toEqual({ dx: 0, dy: 0 });
  });

  test("pulls back one drawn past the right edge", () => {
    // The reported case: a button in the last column, and the text explaining
    // it drawn off the side of the screen.
    expect(clampedOffset(box(880, 1120), screen)).toEqual({ dx: -128, dy: 0 });
  });

  test("pushes out one drawn past the left edge", () => {
    expect(clampedOffset(box(-40, 160), screen)).toEqual({ dx: 48, dy: 0 });
  });

  test("moves one off the top and one off the bottom", () => {
    expect(clampedOffset(box(400, 600, -10, 20), screen).dy).toBe(18);
    expect(clampedOffset(box(400, 600, 780, 810), screen).dy).toBe(-18);
  });

  test("pins the left edge of one wider than the screen", () => {
    // Centring the overflow would cut the beginning and the end both; a
    // tooltip that starts where it can be read is the lesser loss, and the CSS
    // lets it wrap before it ever gets this wide.
    expect(clampedOffset(box(-50, 1100), screen).dx).toBe(58);
  });

  test("moves on both axes at once when it is drawn into a corner", () => {
    expect(clampedOffset(box(950, 1050, 790, 830), screen)).toEqual({ dx: -58, dy: -38 });
  });
});
