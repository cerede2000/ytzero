import { database } from "../../database";
import { log } from "../../logger";

/**
 * Whose library an outside client is looking at.
 *
 * Invidious clients send no session on the endpoints they browse with — Yattee
 * attaches its `SID` cookie only to `/api/v1/auth/*` — so until account support
 * lands there is nobody to derive a profile from, and one has to be named.
 *
 * `YTZERO_INVIDIOUS_COMPAT_USER` names it explicitly. Left unset it is the
 * first administrator, which on a single-profile instance is the only person
 * there. This is why the door stays shut unless opened and belongs behind the
 * instance's own authentication: anyone who reaches these routes browses that
 * profile's library.
 */
let resolved: number | null = null;

export async function compatUserId(): Promise<number> {
  if (resolved !== null) return resolved;
  const named = Number(process.env.YTZERO_INVIDIOUS_COMPAT_USER);
  if (Number.isInteger(named) && named > 0) {
    const row = await database.prepare("SELECT id FROM users WHERE id = ?").get(named) as { id: number } | null;
    if (row) return (resolved = row.id);
    log.warn("invidious.compat_user_missing", { requested: named });
  }
  const fallback = await database
    .prepare("SELECT id FROM users ORDER BY is_admin DESC, sort_order, id LIMIT 1")
    .get() as { id: number } | null;
  if (!fallback) throw new Error("no profile to serve");
  return (resolved = fallback.id);
}
