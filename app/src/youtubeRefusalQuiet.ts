import { callerWasRefused } from "./cookieAttemptOrder";
import { isYouTubeRefusalError, youtubeRefusalGate } from "./youtubeRateLimit";
import { log } from "./logger";

/**
 * When YouTube is refusing this address, every video-info lookup costs the
 * same three attempts — the watch page, InnerTube, the embed — and all three
 * fail. Opening a video pays for them before it can decide which player to
 * show, and the metadata backfill pays for them again in the background.
 *
 * The refusal is about the address, not the video, so one failure speaks for
 * the next ones. It is held briefly: long enough that a page open costs
 * nothing, short enough that the first minute back is the one that notices.
 *
 * Ninety seconds is right for a spell that lifts. It was wrong for one that
 * does not: the metadata backfill runs every three minutes, so the quiet had
 * always expired by the time it came round, and every single batch spent one
 * lookup being told again to sign in — for hours, on an address YouTube was
 * already rate-limiting. Each repeat doubles the wait instead, up to half an
 * hour, and the first answer that gets through puts it back to ninety seconds.
 */
const QUIET_MS = 90_000;
const MAX_QUIET_MS = 30 * 60_000;
/**
 * How many refusals in a row before anything is held.
 *
 * One refusal turned out to mean nothing. Measured across a morning of them:
 * the same command, with the same jar, succeeded every way it was run by hand
 * — alone, five at once, five spaced out — minutes after the application had
 * been turned away by it. A single refusal is weather; two in a row is a
 * spell.
 */
const REFUSALS_BEFORE_QUIET = 2;

export interface RefusalQuiet {
  /** True while YouTube's refusal is still being taken at its word. */
  quiet(): boolean;
  /** Look at a failure; only a refusal of the caller starts a quiet spell. */
  note(error: unknown): void;
  /** Something got through: whatever we were told before no longer holds. */
  clear(): void;
}

/**
 * Whether YouTube is turning this address away, and the way to say that it is.
 *
 * The books are upstream's: `youtubeRefusalGate` counts the consecutive
 * refusals, sets the delay, and lets one probe through when it has elapsed.
 * This is the reading of them — because the gate is consulted by the one
 * function that does the lookups, while the answer is needed by everything
 * that decides *how* to ask: the cookie order, the subtitle fetch, the audio
 * resolver, the refresher, the metadata backfill.
 *
 * Two machines used to keep those books separately, each with its own counter,
 * its own backoff and its own log line for the same event.
 */
export const videoInfoRefusalQuiet = {
  /** True while the gate is holding this address off. */
  quiet(): boolean {
    return youtubeRefusalGate.nextRetryAt() > Date.now();
  },
  /** Report a failure; it counts only if it reads as a refusal of the caller. */
  note(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (callerWasRefused(message) || isYouTubeRefusalError(error)) youtubeRefusalGate.refused(error);
  },
  /** An answer got through: the address is talking to us again. */
  clear(): void {
    youtubeRefusalGate.answered();
  },
};

/** Thrown instead of asking again while the refusal stands. */
export class YouTubeRefusingError extends Error {
  constructor() {
    super("video info skipped: YouTube is refusing this address");
    this.name = "YouTubeRefusingError";
  }
}

/**
 * A refusal of this address, whichever way it arrived.
 *
 * Only the second one and after are `YouTubeRefusingError`: the first is what
 * three real attempts came back with, and it is reported as the failure it is.
 * Callers that treat a refusal differently — by asking again with credentials,
 * or by declining to remember the answer — have to recognise both, or they
 * take the wrong branch exactly once per refusal cycle: on the video that
 * opened it.
 */
export function isYouTubeRefusal(error: unknown): boolean {
  if (error instanceof YouTubeRefusingError) return true;
  // The gate throws its own when it is holding, and a caller that recognised
  // only ours took the wrong branch every time the gate spoke first.
  if (isYouTubeRefusalError(error)) return true;
  return callerWasRefused(error instanceof Error ? error.message : String(error));
}
