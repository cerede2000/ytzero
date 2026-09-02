import { describe, expect, test } from "bun:test";
import { feedSortSql, profileVideoOwnershipExists } from "./feedQueryFragments";

describe("feed sorting", () => {
  test("defaults to YouTube publication order", () => {
    expect(feedSortSql()).toBe("v.published_at");
    expect(feedSortSql("published")).toBe("v.published_at");
  });

  test("supports first-seen arrival order", () => {
    expect(feedSortSql("arrival")).toBe("v.created_at");
  });
});

describe("profile video ownership", () => {
  test("scopes every durable ownership source to the active profile", () => {
    const sql = profileVideoOwnershipExists(42);

    expect(sql).toContain("uc.user_id = 42");
    expect(sql).toContain("ufp.user_id = 42");
    expect(sql).toContain("uv_owner.user_id = 42");
    expect(sql).toContain("h_owner.user_id = 42");
    expect(sql).toContain("vt_owner_tag.user_id = 42");
    expect(sql).toContain("ct_owner_tag.user_id = 42");
    expect(sql).toContain("up_owner.user_id = 42");
    expect(sql).toContain("b_owner.user_id = 42");
    expect(sql).toContain("do_owner.user_id = 42");
    expect(sql).toContain("dr_owner.user_id = 42");
    expect(sql).toContain("sp_owner.author_user_id = 42");
  });
});
