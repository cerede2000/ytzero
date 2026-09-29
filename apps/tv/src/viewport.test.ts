import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DESIGN_WIDTH, resolveTvCanvas } from "./viewport";

test("an Apple television already offers the design canvas, and is left alone", () => {
  expect(resolveTvCanvas({ width: 1920, height: 1080 })).toEqual({ width: 1920, height: 1080, scale: 1, fontScale: 1 });
});

test("a television that reports half the design width gets the canvas back, shrunk onto it", () => {
  const canvas = resolveTvCanvas({ width: 960, height: 540 });
  expect(canvas).toEqual({ width: 1920, height: 1080, scale: 0.5, fontScale: 1 });
  // What the grid reads: the four-column breakpoint is 1400, and the row must
  // fit in what is left beside the sidebar rather than run off the screen.
  expect(canvas.width - 116).toBeGreaterThan(1400);
  expect(canvas.width * canvas.scale).toBe(960);
});

test("a screen wider than the design is given the extra room, not a magnified copy", () => {
  const canvas = resolveTvCanvas({ width: 2560, height: 1440 });
  expect(canvas.scale).toBe(1);
  expect(canvas.width).toBe(2560);
});

test("an unusual aspect ratio keeps its own shape", () => {
  expect(resolveTvCanvas({ width: 960, height: 600 })).toMatchObject({ width: 1920, height: 1200, scale: 0.5 });
});

test("a screen that has not been measured yet divides nothing by zero", () => {
  expect(resolveTvCanvas({ width: 0, height: 0 })).toMatchObject({ width: DESIGN_WIDTH, height: 1080, scale: 1 });
  expect(resolveTvCanvas({ width: Number.NaN, height: 540 })).toMatchObject({ scale: 1 });
});

test("the system text size preference is carried, not absorbed", () => {
  expect(resolveTvCanvas({ width: 960, height: 540, fontScale: 1.3 }).fontScale).toBe(1.3);
  expect(resolveTvCanvas({ width: 960, height: 540, fontScale: 0 }).fontScale).toBe(1);
});

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) found.push(path);
  }
  return found.sort();
}

test("nothing below the root measures the raw window instead of the canvas", () => {
  // The root reads the real screen to size the canvas, and `useViewport` reads
  // it as its fallback. Anywhere else it is half the figure the layout expects.
  const allowed = new Set(["viewport.ts"]);
  const offenders: string[] = [];
  for (const file of sourceFiles(new URL("../src", import.meta.url).pathname)) {
    if (allowed.has(file.split("/").pop()!)) continue;
    if (readFileSync(file, "utf8").includes("useWindowDimensions")) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});

test("every modal applies the canvas again, being a root of its own", () => {
  // React Native gives a modal its own native window on Android, outside the
  // view the root scales. Its contents are written in the same design points,
  // so a modal that forgets this is drawn at twice the size around it.
  const offenders: string[] = [];
  for (const file of sourceFiles(new URL("../src", import.meta.url).pathname)) {
    if (file.endsWith("TvModalCanvas.tsx")) continue;
    const text = readFileSync(file, "utf8");
    if (text.includes("<Modal") && !text.includes("<TvModalCanvas>")) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});

test("the root itself publishes a canvas for everything below it", () => {
  const root = readFileSync(new URL("../App.tsx", import.meta.url).pathname, "utf8");
  expect(root).toContain("resolveTvCanvas");
  expect(root).toContain("<ViewportProvider");
});
