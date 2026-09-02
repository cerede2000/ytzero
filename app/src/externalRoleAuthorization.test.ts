import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = mkdtempSync(resolve(tmpdir(), "ytzero-external-role-auth-test-"));
let result: Record<string, any> = {};

beforeAll(async () => {
  const process = Bun.spawn(["bun", "app/tests/externalRoleAuthorizationHarness.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: { ...Bun.env, DB_PATH: resolve(root, "db", "source.db"), AVATAR_DIR: resolve(root, "avatars") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (exitCode !== 0) throw new Error(`External role auth harness failed:\n${stderr}\n${stdout}`);
  const line = stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`External role auth harness returned no result:\n${stdout}`);
  result = JSON.parse(line.slice("RESULT ".length));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("external group role authorization", () => {
  test("persists validated mappings and exposes stable role identifiers", () => {
    expect(result.saveConfigStatus).toBe(200);
    expect(result.rolesExposed).toBe(true);
    expect(result.mappingsRoundTrip).toBe(true);
    expect(result.invalidMappingStatus).toBe(400);
  });

  test("applies proxy mappings by priority without changing the manual role", () => {
    expect(result.proxyManualStatus).toBe(403);
    expect(result.proxyMappedStatus).toBe(200);
    expect(result.proxyPriorityStatus).toBe(200);
    expect(result.saveFallbackStatus).toBe(200);
    expect(result.proxyFallbackStatus).toBe(200);
  });

  test("applies an OIDC-mapped session role without changing the manual role", () => {
    expect(result.oidcManualStatus).toBe(403);
    expect(result.oidcMappedStatus).toBe(200);
  });

  test("cleans mappings when their role is deleted", () => {
    expect(result.deleteMappedRoleStatus).toBe(200);
    expect(result.deletedRoleRemovedFromProxyMappings).toBe(true);
    expect(result.deletedRoleRemovedFromOidcMappings).toBe(true);
  });
});
