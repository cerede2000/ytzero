/**
 * Which credentials to try first when resolving a media source.
 *
 * The anonymous client is asked first by default, because a logged-in client
 * exposes fewer downloadable formats. That is the right order right up until
 * YouTube stops recognising the address: the anonymous attempt then fails
 * every time, and its two to five seconds are paid before every single
 * resolution — in front of a listener waiting for a track to start.
 *
 * So the order is remembered rather than fixed. Once the anonymous attempt has
 * failed and cookies have carried the same profile through, cookies go first
 * for a while. Nothing is dropped: the other attempt still follows, so a
 * cookie that stops working costs one resolution, not a broken player.
 */

/** How long one anonymous refusal is allowed to speak for the next ones. */
const MEMORY_MS = 15 * 60_000;

/**
 * Whether yt-dlp was turned away for who it is, rather than for what it asked.
 * Only that is worth reordering for: any other failure says nothing about
 * whether cookies would have been quicker.
 */
export function callerWasRefused(stderr: string): boolean {
  const said = stderr.toLowerCase();
  return said.includes("not a bot")
    || said.includes("login_required")
    || said.includes("sign in to confirm")
    || said.includes("this content isn't available");
}

export interface CookieAttemptMemory {
  /** The attempts to make for a profile, in order, as `useCookies` flags. */
  order(userId: number, cookiesConfigured: boolean): boolean[];
  /**
   * Report how an attempt went, so the next order can learn from it.
   * `refused` means YouTube turned the caller away, not that yt-dlp failed.
   */
  record(input: { userId: number; useCookies: boolean; resolved: boolean; refused?: boolean }): void;
}

export function createCookieAttemptMemory({
  now = Date.now,
  memoryMs = MEMORY_MS,
}: { now?: () => number; memoryMs?: number } = {}): CookieAttemptMemory {
  /** Per profile, because cookies are per profile: {anonymousFailedAt, cookiesWorkedAt}. */
  const seen = new Map<number, { anonymousFailedAt: number; cookiesWorkedAt: number }>();

  const entry = (userId: number) => {
    const existing = seen.get(userId);
    if (existing) return existing;
    const created = { anonymousFailedAt: 0, cookiesWorkedAt: 0 };
    seen.set(userId, created);
    return created;
  };

  return {
    order(userId: number, cookiesConfigured: boolean): boolean[] {
      if (!cookiesConfigured) return [false];
      const { anonymousFailedAt, cookiesWorkedAt } = entry(userId);
      if (!anonymousFailedAt || !cookiesWorkedAt) return [false, true];
      const current = now();
      const fresh = current - anonymousFailedAt < memoryMs && current - cookiesWorkedAt < memoryMs;
      return fresh && cookiesWorkedAt >= anonymousFailedAt ? [true, false] : [false, true];
    },
    record({ userId, useCookies, resolved, refused = false }): void {
      const state = entry(userId);
      if (!useCookies && !resolved && refused) state.anonymousFailedAt = now();
      if (useCookies) {
        if (resolved) state.cookiesWorkedAt = now();
        // Cookies failing too says nothing about the order — both are refused,
        // and the anonymous attempt is the one that may come back first.
        else state.cookiesWorkedAt = 0;
      }
      if (!useCookies && resolved) state.anonymousFailedAt = 0;
    },
  };
}

/** Shared by every resolver, so one profile's lesson serves all of them. */
export const cookieAttemptMemory = createCookieAttemptMemory();
