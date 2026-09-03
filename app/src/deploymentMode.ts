import type { DatabaseEngine } from "./databaseConfig";

export const BACKGROUND_TASKS_ENV = "YTZERO_BACKGROUND_TASKS";

/**
 * HTTP replicas can opt out of every periodic/scheduled worker while still
 * accepting requests and enqueueing durable work in PostgreSQL.
 */
export function backgroundTasksEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  const raw = environment[BACKGROUND_TASKS_ENV]?.trim().toLowerCase();
  if (raw === undefined || raw === "" || raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  throw new Error(`${BACKGROUND_TASKS_ENV} must be one of 1, 0, true, false, yes, no, on or off`);
}

export function deploymentMode(engine: DatabaseEngine, environment: Record<string, string | undefined> = process.env) {
  const backgroundTasks = backgroundTasksEnabled(environment);
  return {
    database: engine,
    backgroundTasks,
    httpOnly: !backgroundTasks,
  } as const;
}
