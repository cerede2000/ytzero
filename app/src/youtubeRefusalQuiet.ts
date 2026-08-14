import { callerWasRefused } from "./cookieAttemptOrder";

/**
 * When YouTube is refusing this address, every video-info lookup costs the
 * same three attempts — the watch page, InnerTube, the embed — and all three
 * fail. Opening a video pays for them before it can decide which player to
 * show, and the metadata backfill pays for them again in the background.
 *
 * The refusal is about the address, not the video, so one failure speaks for
 * the next ones. It is held briefly: long enough that a page open costs
 * nothing, short enough that the first minute back is the one that notices.
 */
const QUIET_MS = 90_000;

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
}: { now?: () => number; quietMs?: number } = {}): RefusalQuiet {
  let refusedAt = 0;
  return {
    quiet: () => refusedAt > 0 && now() - refusedAt < quietMs,
    note(error: unknown): void {
      const message = error instanceof Error ? error.message : String(error);
      if (callerWasRefused(message)) refusedAt = now();
    },
    clear(): void {
      refusedAt = 0;
    },
  };
}

/** Shared: the refusal is of the whole address, so it is not per video. */
export const videoInfoRefusalQuiet = createRefusalQuiet();

/** Thrown instead of asking again while the refusal stands. */
export class YouTubeRefusingError extends Error {
  constructor() {
    super("video info skipped: YouTube is refusing this address");
    this.name = "YouTubeRefusingError";
  }
}
