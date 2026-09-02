import { describe, expect, test } from "bun:test";
import { matchedExternalRoleUuid, normalizeExternalGroups, parseExternalRoleMappingConfig } from "./externalRoleMappings";

describe("external role mappings", () => {
  const config = {
    mappings: [
      { group: "parents", role_uuid: "standard" },
      { group: "children", role_uuid: "restricted" },
    ],
    fallback_role_uuid: "guest",
  };

  test("uses mapping order rather than external group order", () => {
    expect(matchedExternalRoleUuid(config, ["children", "parents"])).toBe("standard");
    expect(matchedExternalRoleUuid(config, ["children"])).toBe("restricted");
  });

  test("uses the configured fallback and supports a manual-role fallback", () => {
    expect(matchedExternalRoleUuid(config, ["unknown"])).toBe("guest");
    expect(matchedExternalRoleUuid({ ...config, fallback_role_uuid: null }, [])).toBeNull();
  });

  test("normalizes array and comma-separated group claims", () => {
    expect(normalizeExternalGroups([" parents ", "children", "parents"])).toEqual(["parents", "children"]);
    expect(normalizeExternalGroups("parents, children,parents")).toEqual(["parents", "children"]);
  });

  test("falls back safely for malformed stored configuration", () => {
    expect(parseExternalRoleMappingConfig("not-json")).toEqual({ mappings: [], fallback_role_uuid: null });
    expect(parseExternalRoleMappingConfig('{"mappings":[{"group":"parents","role_uuid":"role"}]}')).toEqual({
      mappings: [{ group: "parents", role_uuid: "role" }],
      fallback_role_uuid: null,
    });
  });
});
