export type VerticalPopoverPlacement = "top" | "bottom";

export function chooseVerticalPopoverPlacement({
  spaceAbove,
  spaceBelow,
  contentHeight,
}: {
  spaceAbove: number;
  spaceBelow: number;
  contentHeight: number;
}): VerticalPopoverPlacement {
  if (contentHeight <= spaceBelow) return "bottom";
  if (contentHeight <= spaceAbove) return "top";
  return spaceBelow >= spaceAbove ? "bottom" : "top";
}
