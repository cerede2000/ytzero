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
}

export const initialAudioStallState: AudioStallState = {
  starvedSince: null,
  healthySince: null,
  recoveries: 0,
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
 * Fold one sample into the watch, reporting whether the player has been unable
 * to play for long enough to warrant rebuilding its source.
 */
export function audioStallStep(
  state: AudioStallState,
  sample: AudioStallSample,
): { state: AudioStallState; recover: boolean } {
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
      },
      recover: false,
    };
  }

  const starvedSince = state.starvedSince ?? sample.at;
  const exhausted = state.recoveries >= AUDIO_STALL_RECOVERY_LIMIT;
  if (sample.at - starvedSince < AUDIO_STALL_GRACE_MS || exhausted) {
    return { state: { ...state, starvedSince, healthySince: null }, recover: false };
  }

  return {
    state: { starvedSince: null, healthySince: null, recoveries: state.recoveries + 1 },
    recover: true,
  };
}
