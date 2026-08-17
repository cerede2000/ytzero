import { describe, expect, test } from "bun:test";
import { feedVisibilityWhere } from "./feedQuery";

describe("a video nobody can open is not offered", () => {
  test("deleted and private are the same fact to a reader", () => {
    // The action paths already required both — downloads, streaming, the direct
    // player all check `is_private = 0 AND is_unavailable = 0`. Only the lists
    // that show videos asked for one of them, so a video whose uploader made it
    // private sat in the feed for good: unplayable, and re-offered every visit.
    const { where } = feedVisibilityWhere({}, 1);
    const sql = where.join(" AND ");
    expect(sql.includes("COALESCE(v.is_unavailable, 0) = 0")).toBe(true);
    expect(sql.includes("COALESCE(v.is_private, 0) = 0")).toBe(true);
  });

  test("and it holds when hidden videos are asked for too", () => {
    // Cleanup's "also match videos hidden from the feed" widens the status
    // conditions; it must not widen this one back.
    const { where } = feedVisibilityWhere({}, 1, { includeHidden: true });
    const sql = where.join(" AND ");
    expect(sql.includes("COALESCE(v.is_private, 0) = 0")).toBe(true);
  });
});
