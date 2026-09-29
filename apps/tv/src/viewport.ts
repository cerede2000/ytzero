import { createContext, useContext } from "react";

/**
 * The canvas this interface is drawn on, and what it takes to cover a screen.
 *
 * Every size in this application is written in Apple TV points, where the
 * screen is always 1920 × 1080 — the theme says so where it pins the smallest
 * reading style to tvOS Caption 2. An Android television reports its own
 * device-independent pixels instead, and the usual figure for a 1080p set, or
 * for a 4K one at twice the density, is 960 × 540. Half.
 *
 * Read literally on such a screen, a 25-point title covers twice the height it
 * was drawn for, the four-column grid falls to three, and the row runs past the
 * right edge because the content floor is wider than the space left for it.
 * Nothing about the television is wrong: the numbers are Apple's.
 *
 * So the interface keeps its own canvas and the root shrinks it onto whatever
 * the platform reports. A screen that already offers the design width is left
 * alone, and a wider one is handed the extra room rather than a magnified copy:
 * this never scales up.
 */
export const DESIGN_WIDTH = 1920;

export interface TvCanvas {
  /** Width in design points — what layout code must measure itself against. */
  width: number;
  /** Height in design points, following the screen's own aspect ratio. */
  height: number;
  /** What the root multiplies the canvas by to cover the real screen. */
  scale: number;
  /** The system's text size preference, which the canvas does not absorb. */
  fontScale: number;
}

export function resolveTvCanvas(screen: { width: number; height: number; fontScale?: number }): TvCanvas {
  const fontScale = Number.isFinite(screen.fontScale) && (screen.fontScale ?? 0) > 0 ? screen.fontScale! : 1;
  const measured = Number.isFinite(screen.width) && screen.width > 0 && Number.isFinite(screen.height) && screen.height > 0;
  // A screen that has not been measured yet must not divide anything by zero.
  if (!measured) return { width: DESIGN_WIDTH, height: Math.round(DESIGN_WIDTH * 9 / 16), scale: 1, fontScale };
  const scale = Math.min(1, screen.width / DESIGN_WIDTH);
  return { width: Math.round(screen.width / scale), height: Math.round(screen.height / scale), scale, fontScale };
}

// Until the root has measured the screen, the canvas is the one the interface
// was drawn on. That is the right answer for Apple and the only safe one here.
const ViewportContext = createContext<TvCanvas>(resolveTvCanvas({ width: DESIGN_WIDTH, height: 1080 }));

/** The root publishes the canvas here; everything below measures against it. */
export const ViewportProvider = ViewportContext.Provider;

/**
 * The canvas to lay out against — never the raw window, which on an Android
 * television is half of it. `viewport.test.ts` holds the application to that.
 */
export function useViewport(): TvCanvas {
  return useContext(ViewportContext);
}
