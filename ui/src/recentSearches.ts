import { rememberedProfileId } from "./profilePreference";

/**
 * The searches this profile ran, offered back the way youtube.com offers them.
 *
 * Typing the same query a second time is most of what a search box is used for,
 * and the completion service cannot help with it: it knows what everyone
 * searches, not what you searched. So this is kept here rather than asked for —
 * and kept per profile, because a household sharing one list of "what was
 * looked up recently" is a household reading each other's searches.
 *
 * `localStorage` rather than the database: it is a convenience, not a record.
 * Nothing here should survive clearing the browser, and nothing should be worth
 * syncing between devices.
 */
const KEY_PREFIX = "ytzero.recentSearches.profile.";
/** Enough to cover coming back to something; short enough to stay a shortlist. */
export const RECENT_SEARCH_LIMIT = 12;
const MAX_QUERY_LENGTH = 120;

function key(profileId: number | null): string {
  return `${KEY_PREFIX}${profileId ?? "unknown"}`;
}

function store(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

export function parseRecentSearches(raw: string | null): string[] {
  if (!raw) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const query = entry.trim().slice(0, MAX_QUERY_LENGTH);
    // Compared without case, because searching "Veritasium" after "veritasium"
    // is the same search and two lines of it is just noise.
    const fold = query.toLowerCase();
    if (!query || seen.has(fold)) continue;
    seen.add(fold);
    out.push(query);
    if (out.length >= RECENT_SEARCH_LIMIT) break;
  }
  return out;
}

export function readRecentSearches(profileId = rememberedProfileId()): string[] {
  return parseRecentSearches(store()?.getItem(key(profileId)) ?? null);
}

/** The list with this query at the front, however it was spelled before. */
export function withRecentSearch(current: readonly string[], query: string): string[] {
  const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (!trimmed) return [...current];
  const fold = trimmed.toLowerCase();
  return [trimmed, ...current.filter((entry) => entry.toLowerCase() !== fold)].slice(0, RECENT_SEARCH_LIMIT);
}

export function rememberSearch(query: string, profileId = rememberedProfileId()): void {
  const next = withRecentSearch(readRecentSearches(profileId), query);
  try { store()?.setItem(key(profileId), JSON.stringify(next)); } catch { /* a full or blocked store is not worth an error */ }
}

export function forgetSearch(query: string, profileId = rememberedProfileId()): void {
  const fold = query.trim().toLowerCase();
  const next = readRecentSearches(profileId).filter((entry) => entry.toLowerCase() !== fold);
  try { store()?.setItem(key(profileId), JSON.stringify(next)); } catch { /* see above */ }
}

/**
 * The recent searches worth offering for what has been typed so far.
 *
 * An empty field offers the lot, which is what a search box does when you
 * arrive at it. Once there is text, only what continues it — a recent search
 * that merely contains the letters somewhere is a coincidence, not a memory.
 */
export function matchingRecentSearches(recent: readonly string[], query: string, limit = 5): string[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return recent.slice(0, limit);
  return recent.filter((entry) => {
    const fold = entry.toLowerCase();
    return fold.startsWith(trimmed) && fold !== trimmed;
  }).slice(0, limit);
}
