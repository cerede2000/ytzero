import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { imageSourceWithHeaders } from "./imageSource";

test("an image source keeps its headers and arrives in the shape both platforms read", () => {
  const source = { uri: "https://instance.example/api/img?u=x", headers: { Authorization: "Bearer token" } };
  expect(imageSourceWithHeaders(source)).toEqual([source]);
});

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")) found.push(path);
  }
  return found.sort();
}

/** The expression inside the `source={…}` of an image element, braces balanced. */
function imageSourceExpressions(text: string): string[] {
  const expressions: string[] = [];
  const opening = /<(?:Animated\.)?Image(?![A-Za-z])/g;
  for (let tag = opening.exec(text); tag; tag = opening.exec(text)) {
    const attribute = text.indexOf("source={", tag.index);
    if (attribute === -1) continue;
    let depth = 1;
    let index = attribute + "source={".length;
    const start = index;
    while (index < text.length && depth > 0) {
      if (text[index] === "{") depth += 1;
      else if (text[index] === "}") depth -= 1;
      index += 1;
    }
    expressions.push(text.slice(start, index - 1).trim());
  }
  return expressions;
}

test("every image hands its source over in that shape, so none of them loses the bearer", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(new URL("../src", import.meta.url).pathname)) {
    for (const expression of imageSourceExpressions(readFileSync(file, "utf8"))) {
      if (!expression.startsWith("imageSourceWithHeaders(")) offenders.push(`${file}: source={${expression}}`);
    }
  }
  expect(offenders).toEqual([]);
});

test("the scan reads a source expression whole, including one that nests braces", () => {
  const text = `
    <Image source={api.thumbnailSource(video.thumbnail)} style={styles.image} />
    <Animated.Image source={failed ? fallback : { uri, headers: { Authorization: token } }} />
    <ImageBackground source={notAnImageElement} />
  `;
  expect(imageSourceExpressions(text)).toEqual([
    "api.thumbnailSource(video.thumbnail)",
    "failed ? fallback : { uri, headers: { Authorization: token } }",
  ]);
});
