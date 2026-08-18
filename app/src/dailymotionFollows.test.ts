import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { watchedFromProgress } from "./dailymotionFollows";

const schema = readFileSync(new URL("dailymotionSchema.sql", import.meta.url), "utf8");
/** The statements alone: the prose above them says "references" and means it in English. */
const statements = schema.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");

describe("Dailymotion's own corner of the database", () => {
  test("stands on its own, referencing nothing", () => {
    // The whole promise of the experiment: it can be removed by dropping these
    // tables. A foreign key either way would make that a migration through
    // somebody else's rows, and would put a Dailymotion id in a column that
    // means YouTube's.
    expect(statements.toLowerCase()).not.toContain("references");
    expect(schema).toContain("dailymotion_follows");
    expect(schema).toContain("dailymotion_progress");
  });

  test("and applies to an empty database with nothing else in it", () => {
    const database = new Database(":memory:");
    database.exec(schema);
    const tables = database.query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all().map((row) => row.name);
    expect(tables).toEqual(["dailymotion_follows", "dailymotion_progress"]);
  });

  test("remembers one instant per follow, and no video", () => {
    const database = new Database(":memory:");
    database.exec(schema);
    const columns = database.query<{ name: string }, []>("PRAGMA table_info(dailymotion_follows)")
      .all().map((row) => row.name);
    expect(columns).toContain("seen_through");
    // Nothing here holds a title, a thumbnail or a duration: those are
    // Dailymotion's, asked for when needed rather than kept current here.
    expect(columns).not.toContain("title");
    expect(columns).not.toContain("thumbnail");
  });
});

describe("when a Dailymotion video counts as watched", () => {
  test("past the credits, not before", () => {
    expect(watchedFromProgress(3500, 3600)).toBe(true);
    expect(watchedFromProgress(3420, 3600)).toBe(true);
    expect(watchedFromProgress(3419, 3600)).toBe(false);
    expect(watchedFromProgress(842.5, 3600)).toBe(false);
  });

  test("and never on a duration nobody knows", () => {
    // Guessing would either resume somebody at the credits or forget they had
    // finished. Unknown means not watched, which is the recoverable mistake.
    expect(watchedFromProgress(500, null)).toBe(false);
    expect(watchedFromProgress(500, 0)).toBe(false);
    expect(watchedFromProgress(Number.NaN, 3600)).toBe(false);
  });
});
