import { describe, expect, test } from "bun:test";
import {
  AUDIO_STALL_GRACE_MS,
  AUDIO_STALL_HEALTHY_RESET_MS,
  AUDIO_STALL_RECOVERY_LIMIT,
  audioStallStep,
  bufferedSecondsAhead,
  initialAudioStallState,
  type AudioStallSample,
  type AudioStallState,
} from "./audioStallWatch";

const HEALTHY = { currentTime: 42, paused: false, ended: false, seeking: false, readyState: 4, bufferedAhead: 10 };
const STARVED = { ...HEALTHY, readyState: 1, bufferedAhead: 0 };

const TICK_MS = 1_000;

/** Feed one second of samples per tick and count the recoveries asked for. */
function run(
  ticks: Array<Partial<AudioStallSample>>,
  start: AudioStallState = initialAudioStallState,
  startedAt = 0,
): {
  state: AudioStallState;
  recoveries: number;
  nudges: number;
  recoveredAt: number[];
  actions: Array<{ at: number; action: string }>;
} {
  let state = start;
  const actions: Array<{ at: number; action: string }> = [];
  ticks.forEach((tick, index) => {
    const at = startedAt + index * TICK_MS;
    const step = audioStallStep(state, { at, ...HEALTHY, ...tick });
    state = step.state;
    if (step.action !== "none") actions.push({ at, action: step.action });
  });
  const recoveredAt = actions.filter((entry) => entry.action === "rebuild").map((entry) => entry.at);
  return {
    state,
    recoveries: recoveredAt.length,
    nudges: actions.filter((entry) => entry.action === "nudge").length,
    recoveredAt,
    actions,
  };
}

const repeat = (count: number, tick: Partial<AudioStallSample>): Array<Partial<AudioStallSample>> =>
  Array.from({ length: count }, () => tick);

const GRACE_TICKS = AUDIO_STALL_GRACE_MS / TICK_MS;

describe("buffer ahead of the playhead", () => {
  const ranges = (pairs: Array<[number, number]>) => ({
    length: pairs.length,
    start: (index: number) => pairs[index]![0],
    end: (index: number) => pairs[index]![1],
  });

  test("measures the range covering the playhead", () => {
    expect(bufferedSecondsAhead(ranges([[0, 30]]), 10)).toBe(20);
    expect(bufferedSecondsAhead(ranges([[0, 30], [120, 180]]), 130)).toBe(50);
  });

  test("reports nothing when the playhead sits outside every range", () => {
    expect(bufferedSecondsAhead(ranges([[0, 30]]), 90)).toBe(0);
    expect(bufferedSecondsAhead(ranges([]), 0)).toBe(0);
  });
});

describe("audio stall watch", () => {
  test("leaves healthy playback alone", () => {
    expect(run(repeat(600, HEALTHY)).recoveries).toBe(0);
  });

  test("treats short starvation as ordinary buffering", () => {
    expect(run([...repeat(GRACE_TICKS - 1, STARVED), ...repeat(10, HEALTHY)]).actions).toEqual([]);
  });

  test("asks the player to retry before rebuilding anything", () => {
    // Rebuilding is not free: on iOS the replaced element can keep fetching,
    // so the cheap request-again is always tried first.
    expect(run(repeat(GRACE_TICKS * 2 + 1, STARVED)).actions).toEqual([
      { at: AUDIO_STALL_GRACE_MS, action: "nudge" },
      { at: AUDIO_STALL_GRACE_MS * 2, action: "rebuild" },
    ]);
  });

  test("stops at the nudge when it gets the player playing again", () => {
    const { nudges, recoveries } = run([...repeat(GRACE_TICKS + 1, STARVED), ...repeat(30, HEALTHY)]);
    expect(nudges).toBe(1);
    expect(recoveries).toBe(0);
  });

  test("counts starvation the player announces as progress it cannot play", () => {
    // readyState claims data is available while no buffered range covers the
    // playhead: the face of the bug where the clock advances in silence.
    const advancing = { ...HEALTHY, readyState: 4, bufferedAhead: 0 };
    expect(run(repeat(GRACE_TICKS + 1, advancing)).nudges).toBe(1);
  });

  test("leaves a player that has not started opening its source", () => {
    // Resolving a source can take several seconds, and the element sits at
    // zero unpaused throughout: rebuilding there would only restart the wait.
    expect(run(repeat(120, { ...STARVED, currentTime: 0 })).actions).toEqual([]);
  });

  test("never acts on a paused, ended, or seeking player", () => {
    for (const state of [{ paused: true }, { ended: true }, { seeking: true }]) {
      expect(run(repeat(120, { ...STARVED, ...state })).actions).toEqual([]);
    }
  });

  test("waits out the grace period again after each recovery", () => {
    const { recoveredAt } = run(repeat(GRACE_TICKS * 6 + 3, STARVED));
    expect(recoveredAt).toEqual([
      AUDIO_STALL_GRACE_MS * 2,
      AUDIO_STALL_GRACE_MS * 4 + TICK_MS,
      AUDIO_STALL_GRACE_MS * 6 + TICK_MS * 2,
    ]);
  });

  test("stops rebuilding a source that will not play", () => {
    const { recoveries, state } = run(repeat(600, STARVED));
    expect(recoveries).toBe(AUDIO_STALL_RECOVERY_LIMIT);
    expect(state.recoveries).toBe(AUDIO_STALL_RECOVERY_LIMIT);
  });

  test("earns the attempts back after sustained healthy playback", () => {
    const exhausted = run(repeat(600, STARVED)).state;
    const healthyTicks = AUDIO_STALL_HEALTHY_RESET_MS / TICK_MS + 1;
    const recovered = run(repeat(healthyTicks, HEALTHY), exhausted).state;
    expect(recovered.recoveries).toBe(0);
    expect(run(repeat(GRACE_TICKS * 2 + 1, STARVED), recovered).recoveries).toBe(1);
  });

  test("does not let a paused player earn attempts back", () => {
    const exhausted = run(repeat(600, STARVED)).state;
    const pausedTicks = AUDIO_STALL_HEALTHY_RESET_MS / TICK_MS + 60;
    const afterPause = run(repeat(pausedTicks, { ...HEALTHY, paused: true }), exhausted).state;
    expect(afterPause.recoveries).toBe(AUDIO_STALL_RECOVERY_LIMIT);
  });
});
