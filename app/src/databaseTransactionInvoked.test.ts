import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/*
 * `database.transaction(callback)` does not run anything. It returns a function
 * that opens the transaction when it is called, so a statement written as
 *
 *     await database.transaction(async () => { ... });
 *
 * awaits the function itself and never touches the database. It type-checks,
 * it throws nothing and it logs nothing. Three routes shipped like that: a video
 * imported from a search result was never written, so the Invidious detail and
 * every "act on a search result" answered not found; a session queue saved as a
 * playlist created none; a video removed from a personal playlist stayed in it.
 *
 * The mistake is in how the call is written, so it is looked for there.
 */
const SOURCE = join(import.meta.dir);

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

/** Each `.transaction(...)` whose result is neither called nor kept to call later. */
export function uninvokedTransactions(text: string): number[] {
  const lines: number[] = [];
  for (const match of text.matchAll(/\.transaction\(/g)) {
    let depth = 0;
    let end = match.index! + match[0].length - 1;
    for (; end < text.length; end++) {
      if (text[end] === "(") depth++;
      else if (text[end] === ")" && --depth === 0) break;
    }
    const invoked = text[end + 1] === "(";
    const lineStart = text.lastIndexOf("\n", match.index!) + 1;
    const before = text.slice(lineStart, match.index!).trim();
    // Kept under a name, or handed back, to be called by whoever holds it.
    const kept = /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*[\w.]*$/.test(before) || /^return\s+[\w.]*$/.test(before);
    if (!invoked && !kept) lines.push(text.slice(0, match.index!).split("\n").length);
  }
  return lines;
}

describe("database transactions", () => {
  test("the check sees a transaction that is awaited without being called", () => {
    expect(uninvokedTransactions("await database.transaction(async () => {\n  await write();\n});")).toEqual([1]);
    expect(uninvokedTransactions("const row = await database.transaction(async () => read());")).toEqual([1]);
    expect(uninvokedTransactions("await database.transaction(async () => {\n  await write();\n})();")).toEqual([]);
    expect(uninvokedTransactions("const save = database.transaction(async (rows) => write(rows));")).toEqual([]);
  });

  test("every transaction the server builds is also run", () => {
    const offenders = sources(SOURCE).flatMap((path) =>
      uninvokedTransactions(readFileSync(path, "utf8")).map((line) => `${relative(SOURCE, path)}:${line}`));
    expect(offenders).toEqual([]);
  });
});
