import { log } from "./logger";

/**
 * Getting out of the way while somebody is watching.
 *
 * The background work this server does is all yt-dlp: refreshing channels,
 * checking what is still live, filling in durations, syncing playlists. Each
 * pass is a handful of extractions, and they land whenever their interval says
 * so — including in the seconds after somebody presses play.
 *
 * Measured on the instance: a file fetched by hand on a quiet machine ran at
 * twenty-five megabytes a second; the same fetch, while a ten-channel refresh
 * and a seventy-one-channel live sweep were under way, ran at two hundred
 * kilobytes a second. Nothing was broken — the work was simply queued behind
 * everything else the server had decided to do at that moment.
 *
 * So a pass that falls during playback is skipped rather than run. It costs
 * nothing to skip: every one of these runs on an interval and will come round
 * again. What it must not do is skip for ever, which is why a job that has
 * been stood aside for long enough runs anyway.
 */

/** How long after the last byte served the viewer is still considered watching. */
const WATCHING_MS = 90_000;
/** However busy the player is, no job waits longer than this. */
const MAX_DEFERRAL_MS = 30 * 60_000;

let lastServedAt = 0;

/** Called wherever bytes go out to a player. */
export function notePlayback(now: number = Date.now()): void {
  lastServedAt = now;
}

export function playbackActive(now: number = Date.now()): boolean {
  return lastServedAt > 0 && now - lastServedAt < WATCHING_MS;
}

/** Test seam: forget that anyone was watching. */
export function forgetPlayback(): void {
  lastServedAt = 0;
}

export interface DeferrableJob {
  /** When this job last actually ran, so it cannot be deferred for ever. */
  lastRunAt: number;
}

/**
 * Whether a scheduled pass should run now, and why not when it should not.
 *
 * Deliberately pure: the decision is the part worth being sure of, and it is
 * made of two clocks and a rule.
 */
export function shouldRunNow(
  job: DeferrableJob,
  now: number,
  watching: boolean,
  maxDeferralMs: number = MAX_DEFERRAL_MS,
): boolean {
  if (!watching) return true;
  return now - job.lastRunAt >= maxDeferralMs;
}

/**
 * Wrap a scheduled pass so it stands aside while somebody is watching.
 *
 * The skip is logged once per job per quiet period rather than every tick: a
 * long film would otherwise fill the log with the same line.
 */
export function deferrable(name: string, run: () => unknown): () => void {
  const job: DeferrableJob = { lastRunAt: Date.now() };
  let announced = false;
  return () => {
    const now = Date.now();
    if (!shouldRunNow(job, now, playbackActive(now))) {
      if (!announced) {
        announced = true;
        log.info("scheduler.deferred_while_watching", { job: name });
      }
      return;
    }
    announced = false;
    job.lastRunAt = now;
    void run();
  };
}

/** A pass that runs on an interval and stands aside while somebody is watching. */
export function scheduleDeferrable(name: string, firstMs: number, everyMs: number, run: () => unknown): void {
  const job = deferrable(name, run);
  setTimeout(job, firstMs);
  setInterval(job, everyMs);
}
