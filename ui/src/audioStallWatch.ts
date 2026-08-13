/**
 * A starved audio element does not report an error. It keeps its source, keeps
 * its position, and simply never plays again — so the error state that offers
 * the retry button is never reached and the track stays silent for good. The
 * only way to tell that apart from ordinary buffering is that it lasts.
 *
 * Two signals are needed because a starved player can present either face: one
 * that stops on `waiting` with nothing buffered ahead, and one that keeps
 * announcing progress it cannot play. Buffer ahead of the playhead covers both,
 * and readyState catches the moment before any range is reported at all.
 */

/** Seconds of buffer ahead of the playhead below which nothing can be played. */
const STARVED_BUFFER_SECONDS = 0.25;

/** HTMLMediaElement.HAVE_FUTURE_DATA, spelled out for non-DOM callers. */
const HAVE_FUTURE_DATA = 3;

/**
 * How long starvation must last before it stops being ordinary buffering.
 * Short enough to act before a listener gives up and seeks elsewhere, which
 * only a starting player would reach too easily — hence the guard below.
 */
export const AUDIO_STALL_GRACE_MS = 4_000;

/** Recoveries are capped so a source that cannot play never loops forever. */
export const AUDIO_STALL_RECOVERY_LIMIT = 3;

/** Sustained healthy playback earns the cap back for the rest of the track. */
export const AUDIO_STALL_HEALTHY_RESET_MS = 30_000;

export interface BufferedRanges {
  readonly length: number;
  start(index: number): number;
  end(index: number): number;
}

export interface AudioStallSample {
  /** Wall clock of this sample, in milliseconds. */
  at: number;
  currentTime: number;
  paused: boolean;
  ended: boolean;
  seeking: boolean;
  readyState: number;
  bufferedAhead: number;
}

export interface AudioStallState {
  starvedSince: number | null;
  healthySince: number | null;
  recoveries: number;
  /** Whether this episode of starvation has already been asked to retry. */
  nudged: boolean;
}

export const initialAudioStallState: AudioStallState = {
  starvedSince: null,
  healthySince: null,
  recoveries: 0,
  nudged: false,
};

/**
 * Seconds of contiguous buffer covering the playhead. A seek lands outside
 * every buffered range, which reads as zero until the new position fills.
 */
export function bufferedSecondsAhead(ranges: BufferedRanges, currentTime: number): number {
  for (let index = 0; index < ranges.length; index += 1) {
    const start = ranges.start(index);
    const end = ranges.end(index);
    if (currentTime >= start && currentTime <= end) return Math.max(0, end - currentTime);
  }
  return 0;
}

/**
 * What to do about a player that has stopped being able to play.
 *
 * A stalled reader is one whose request for the position it needs was never
 * issued, so the cheap answer is to make it ask again: moving the playhead
 * forces a fresh request without disturbing the element. Rebuilding the source
 * is the heavy answer, and not a free one — on iOS a replaced element can keep
 * fetching on its own, leaving a second loader competing with the new one.
 */
export type AudioStallAction = "none" | "nudge" | "rebuild";

/**
 * Fold one sample into the watch, reporting what the player needs after being
 * unable to play for long enough that it is no longer ordinary buffering.
 */
export function audioStallStep(
  state: AudioStallState,
  sample: AudioStallSample,
): { state: AudioStallState; action: AudioStallAction } {
  // A player that has not moved off zero is still opening its source, which
  // can take seconds while yt-dlp resolves; rebuilding it there would only
  // restart the wait. Starvation is a claim about playback that had begun.
  const started = sample.currentTime > 0;
  const wantsToPlay = started && !sample.paused && !sample.ended && !sample.seeking;
  const starved = sample.bufferedAhead < STARVED_BUFFER_SECONDS || sample.readyState < HAVE_FUTURE_DATA;

  if (!wantsToPlay || !starved) {
    // Only playback that is both wanted and possible counts as healthy, so a
    // paused player never earns back recovery attempts it did not spend.
    const healthySince = wantsToPlay ? state.healthySince ?? sample.at : null;
    const healthyFor = healthySince === null ? 0 : sample.at - healthySince;
    const recovered = healthyFor >= AUDIO_STALL_HEALTHY_RESET_MS;
    return {
      state: {
        starvedSince: null,
        healthySince: recovered ? sample.at : healthySince,
        recoveries: recovered ? 0 : state.recoveries,
        // A nudge is spent for as long as the player still cannot play. The
        // seek it performs briefly lands here, and forgetting it there would
        // loop on nudges that are not working instead of escalating.
        nudged: starved && state.nudged,
      },
      action: "none",
    };
  }

  const starvedSince = state.starvedSince ?? sample.at;
  if (sample.at - starvedSince < AUDIO_STALL_GRACE_MS) {
    return { state: { ...state, starvedSince, healthySince: null }, action: "none" };
  }

  // Ask again before tearing anything down, and give the answer a grace period
  // of its own: a request that does go out still has to travel.
  if (!state.nudged) {
    return {
      state: { ...state, starvedSince: sample.at, healthySince: null, nudged: true },
      action: "nudge",
    };
  }

  if (state.recoveries >= AUDIO_STALL_RECOVERY_LIMIT) {
    return { state: { ...state, starvedSince, healthySince: null }, action: "none" };
  }

  return {
    state: { starvedSince: null, healthySince: null, recoveries: state.recoveries + 1, nudged: false },
    action: "rebuild",
  };
}
