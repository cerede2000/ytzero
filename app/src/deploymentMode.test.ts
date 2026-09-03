import { describe, expect, test } from "bun:test";
import { backgroundTasksEnabled, deploymentMode } from "./deploymentMode";

describe("deployment mode", () => {
  test("keeps single-instance background work enabled by default", () => {
    expect(backgroundTasksEnabled({})).toBe(true);
    expect(deploymentMode("sqlite", {})).toEqual({ database: "sqlite", backgroundTasks: true, httpOnly: false });
  });

  test("accepts common explicit boolean values", () => {
    for (const value of ["0", "false", "no", "off"]) expect(backgroundTasksEnabled({ YTZERO_BACKGROUND_TASKS: value })).toBe(false);
    for (const value of ["1", "true", "yes", "on"]) expect(backgroundTasksEnabled({ YTZERO_BACKGROUND_TASKS: value })).toBe(true);
    expect(deploymentMode("postgres", { YTZERO_BACKGROUND_TASKS: "0" })).toEqual({ database: "postgres", backgroundTasks: false, httpOnly: true });
  });

  test("rejects ambiguous configuration instead of silently starting workers", () => {
    expect(() => backgroundTasksEnabled({ YTZERO_BACKGROUND_TASKS: "sometimes" })).toThrow("YTZERO_BACKGROUND_TASKS");
  });
});
