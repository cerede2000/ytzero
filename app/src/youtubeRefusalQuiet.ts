import { callerWasRefused } from "./cookieAttemptOrder";
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

export function createRefusalQuiet({
  now = Date.now,
  quietMs = QUIET_MS,
  maxQuietMs = MAX_QUIET_MS,
  onChange = () => {},
}: {
  now?: () => number;
  quietMs?: number;
  maxQuietMs?: number;
  /** Called only when the answer changes, so a log says it once. */
  onChange?: (refusing: boolean) => void;
} = {}): RefusalQuiet {
  let refusedAt = 0;
  let refusals = 0;
  /** When one attempt was last let through to see whether the spell has lifted. */
  let probedAt = 0;
  /** Doubling per consecutive refusal: 90s, 3m, 6m, 12m, 24m, then capped. */
  const window = () => Math.min(quietMs * 2 ** Math.max(0, refusals - 1), maxQuietMs);
  /*
   * Quiet, but never sealed.
   *
   * This used to hold until its window elapsed, and the window only ever grew:
   * ninety seconds, then three minutes, six, twelve, twenty-four, thirty. It
   * lifted early on a success — which could not happen, because while it held
   * nothing was attempted, so nothing could succeed. A refusal lasting seconds
   * therefore cost the best part of an hour, and there was no way out but to
   * wait.
   *
   * So one attempt is let through every base interval. An address that has
   * recovered is noticed within ninety seconds instead of at the end of a
   * window that keeps doubling, and the cost is one lookup a minute and a half
   * rather than every lookup asked for.
   */
  const quiet = () => {
    if (refusedAt === 0 || now() - refusedAt >= window()) return false;
    if (now() - probedAt >= quietMs) {
      probedAt = now();
      return false;
    }
    return true;
  };
  return {
    quiet,
    note(error: unknown): void {
      const message = error instanceof Error ? error.message : String(error);
      if (!callerWasRefused(message)) return;
      const was = refusedAt > 0 && now() - refusedAt < window();
      refusals++;
      // Below the threshold nothing is held: the refusal is remembered so a
      // second one counts, and that is all.
      if (refusals < REFUSALS_BEFORE_QUIET) return;
      refusedAt = now();
      // The next probe is due an interval from here, not immediately: arming
      // and then letting the very next question through would hold nothing.
      probedAt = refusedAt;
      if (!was) onChange(true);
    },
    clear(): void {
      const was = refusedAt > 0 && now() - refusedAt < window();
      refusedAt = 0;
      refusals = 0;
      probedAt = 0;
      if (was) onChange(false);
    },
  };
}

/**
 * Shared: the refusal is of the whole address, so it is not per video — and
 * saying so once is the whole point. Reporting every skipped lookup instead
 * turns one piece of news into a page of it.
 */
export const videoInfoRefusalQuiet = createRefusalQuiet({
  onChange: (refusing) => log.info(refusing ? "youtube.address_refused" : "youtube.address_accepted", {
    detail: refusing ? "video lookups are being skipped for now" : "video lookups have resumed",
  }),
});

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
  return callerWasRefused(error instanceof Error ? error.message : String(error));
}
