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
  onChange = () => {},
}: {
  now?: () => number;
  quietMs?: number;
  /** Called only when the answer changes, so a log says it once. */
  onChange?: (refusing: boolean) => void;
} = {}): RefusalQuiet {
  let refusedAt = 0;
  const quiet = () => refusedAt > 0 && now() - refusedAt < quietMs;
  return {
    quiet,
    note(error: unknown): void {
      const message = error instanceof Error ? error.message : String(error);
      if (!callerWasRefused(message)) return;
      const was = quiet();
      refusedAt = now();
      if (!was) onChange(true);
    },
    clear(): void {
      const was = quiet();
      refusedAt = 0;
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
