/**
 * How far a tooltip has to move to stay on screen.
 *
 * A tooltip in a portal is placed from its anchor: beside a button near the
 * right edge, it is drawn past the edge and the text that explains the button
 * is the part that falls off. Nothing clips it — it is simply outside.
 *
 * The shift is measured after the tooltip is drawn, because its width is its
 * text's, and applied to the placement rather than to the transform, so the
 * arrow-side geometry the CSS sets up stays as it is.
 */
export interface Box { left: number; right: number; top: number; bottom: number }
export interface Viewport { width: number; height: number }

export function clampedOffset(box: Box, viewport: Viewport, margin = 8): { dx: number; dy: number } {
  return { dx: axisOffset(box.left, box.right, viewport.width, margin), dy: axisOffset(box.top, box.bottom, viewport.height, margin) };
}

function axisOffset(start: number, end: number, size: number, margin: number): number {
  // Wider than the screen: pin the readable end rather than centring the
  // overflow, which would cut both sides at once.
  if (end - start >= size - margin * 2) return margin - start;
  if (end > size - margin) return size - margin - end;
  if (start < margin) return margin - start;
  return 0;
}
