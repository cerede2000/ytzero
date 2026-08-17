import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { downloadCookiesConfigured, downloadCookiesFile } from "./downloadConfig";
import { log } from "./logger";
import { fetchYoutubeSessionState } from "./youtube";
import { youtubeCookieHeader } from "./youtubeCookieHeader";
import { mergeSetCookies } from "./youtubeCookieJar";

/**
 * Whether YouTube still knows the account behind a profile's jar.
 *
 * Presenting a jar and being known for it are not the same thing, and an
 * expired one is not refused: it is answered as a stranger would be. Every
 * signed-in page still parses, every panel still fills, and nothing says the
 * account stopped being recognised — until playback fails hours later for
 * what looks like an unrelated reason.
 *
 * So the answer is recorded whenever one is obtained, and shown where the jar
 * is managed.
 */
export interface CookieHealth {
  recognised: boolean;
  at: number;
}

const health = new Map<number, CookieHealth>();

export function recordCookieRecognition(userId: number, recognised: boolean, now: () => number = Date.now): void {
  const before = health.get(userId);
  health.set(userId, { recognised, at: now() });
  if (before?.recognised !== recognised) {
    log[recognised ? "info" : "warn"](recognised ? "cookies.recognised" : "cookies.not_recognised", { userId });
  }
}

export function cookieHealth(userId: number): CookieHealth | null {
  return health.get(userId) ?? null;
}

export function forgetCookieHealth(userId: number): void {
  health.delete(userId);
}

/** How long an answer stands before the question is worth putting again. */
const HEALTH_TTL_MS = 10 * 60_000;

/**
 * The answer, asking YouTube if nobody has lately.
 *
 * The panel is fetched anonymously unless the reader asked otherwise, so
 * nothing else necessarily makes a signed-in request: a state that only
 * recorded what happened to pass by would stay unknown for ever on most
 * instances, which is the same as not having it.
 */
export async function currentCookieHealth(
  userId: number,
  now: () => number = Date.now,
  ask = fetchYoutubeSessionState,
  header = youtubeCookieHeader,
): Promise<CookieHealth | null> {
  const known = health.get(userId);
  if (known && now() - known.at < HEALTH_TTL_MS) return known;
  // One source of truth for "is there a jar worth asking with": the header
  // builder already answers null when there is none.
  const cookieHeader = header(userId);
  if (!cookieHeader) return null;
  try {
    const state = await ask(cookieHeader);
    recordCookieRecognition(userId, state.signedIn, now);
    persistSetCookies(userId, state.setCookies);
  } catch (error) {
    // A question that could not be put is not an answer: whatever was known
    // stands rather than being replaced by a network failure.
    log.warn("cookies.check_failed", { userId, error: error instanceof Error ? error.message : String(error) });
  }
  return health.get(userId) ?? null;
}

/**
 * Write back what a response rotated, the way a browser would.
 *
 * The file is replaced through a temporary neighbour so a jar is never left
 * half-written: it is the only copy of a session that cannot be recreated
 * without going back to a browser.
 */
export function persistSetCookies(userId: number, setCookies: readonly string[]): void {
  if (setCookies.length === 0 || !downloadCookiesConfigured(userId)) return;
  const path = downloadCookiesFile(userId);
  try {
    const merged = mergeSetCookies(readFileSync(path, "utf8"), setCookies);
    if (!merged) return;
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, merged, { mode: 0o600 });
    renameSync(temporary, path);
    try { chmodSync(path, 0o600); } catch { /* unsupported on some hosts */ }
    log.info("cookies.refreshed", { userId, updates: setCookies.length });
  } catch (error) {
    // A jar that could not be refreshed is still the jar that was working a
    // moment ago; losing it would cost a trip to a browser.
    log.warn("cookies.refresh_failed", { userId, error: error instanceof Error ? error.message : String(error) });
  }
}
