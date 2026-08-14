import { describe, expect, test } from "bun:test";
import { createPotProviderWarmer } from "./ytdlpPotProvider";

function fakeSpawn(runs: string[][], exitCode = 0): typeof Bun.spawn {
  return ((command: string[]) => {
    runs.push(command);
    return { exited: Promise.resolve(exitCode), kill: () => {} };
  }) as unknown as typeof Bun.spawn;
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("proof-of-origin warmer", () => {
  test("computes one before anyone is waiting for it", async () => {
    const runs: string[][] = [];
    createPotProviderWarmer({ home: "/opt/provider", spawn: fakeSpawn(runs) })();
    await settled();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.at(-1)).toBe("/opt/provider/src/generate_once.ts");
  });

  test("does nothing at all when no provider is installed", async () => {
    const runs: string[][] = [];
    createPotProviderWarmer({ home: null, spawn: fakeSpawn(runs) })();
    await settled();
    expect(runs).toHaveLength(0);
  });

  test("browsing keeps it warm without paying again", async () => {
    const runs: string[][] = [];
    const clock = { value: 1_000 };
    const warm = createPotProviderWarmer({
      home: "/opt/provider",
      now: () => clock.value,
      intervalMs: 1_000,
      spawn: fakeSpawn(runs),
    });
    warm();
    await settled();
    warm();
    warm();
    await settled();
    expect(runs).toHaveLength(1);

    clock.value += 1_000;
    warm();
    await settled();
    expect(runs).toHaveLength(2);
  });

  test("never runs two at once", async () => {
    const runs: string[][] = [];
    let release: () => void = () => {};
    const warm = createPotProviderWarmer({
      home: "/opt/provider",
      spawn: ((command: string[]) => {
        runs.push(command);
        return { exited: new Promise<number>((resolve) => { release = () => resolve(0); }), kill: () => {} };
      }) as unknown as typeof Bun.spawn,
    });
    warm();
    await settled();
    warm();
    await settled();
    expect(runs).toHaveLength(1);
    release();
  });

  test("tries again after a failure rather than pretending it is warm", async () => {
    const runs: string[][] = [];
    const warm = createPotProviderWarmer({
      home: "/opt/provider",
      intervalMs: 1_000_000,
      spawn: fakeSpawn(runs, 1),
    });
    warm();
    await settled();
    warm();
    await settled();
    expect(runs).toHaveLength(2);
  });
});
