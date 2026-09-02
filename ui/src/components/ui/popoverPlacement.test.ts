import { describe, expect, test } from "bun:test";
import { chooseVerticalPopoverPlacement } from "./popoverPlacement";

describe("popover vertical placement", () => {
  test("prefers the default bottom placement when the content fits", () => {
    expect(chooseVerticalPopoverPlacement({ spaceAbove: 500, spaceBelow: 300, contentHeight: 240 })).toBe("bottom");
  });

  test("flips above when the content only fits there", () => {
    expect(chooseVerticalPopoverPlacement({ spaceAbove: 400, spaceBelow: 120, contentHeight: 260 })).toBe("top");
  });

  test("uses the roomier side when neither direction fully fits", () => {
    expect(chooseVerticalPopoverPlacement({ spaceAbove: 180, spaceBelow: 220, contentHeight: 300 })).toBe("bottom");
    expect(chooseVerticalPopoverPlacement({ spaceAbove: 260, spaceBelow: 140, contentHeight: 300 })).toBe("top");
  });
});
