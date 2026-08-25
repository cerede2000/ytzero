import { existsSync, realpathSync } from "node:fs";
import { log } from "./logger";
import { join } from "node:path";

/**
 * Proof-of-origin tokens for yt-dlp.
 *
 * YouTube increasingly answers an unrecognised caller with "Sign in to confirm
 * you're not a bot", and hands its web clients media URLs that are bound to a
 * token the caller is expected to have computed. Cookies alone do not settle
 * either: they get an extraction through, and the URL that comes back is then
 * refused to whoever fetches it. A provider computes that token, and yt-dlp
 * asks it through a plugin — over HTTP to a companion service, or by running
 * a script under a JavaScript runtime that is already here.
 *
 * Nothing below is required for a caller YouTube is happy with: with no
 * provider installed these arguments are empty and yt-dlp behaves as before.
 */

/** Where the image installs the provider; the script is run from here. */
const DEFAULT_POT_PROVIDER_HOME = "/opt/bgutil-ytdlp-pot-provider/server";

export interface PotProviderEnvironment {
  /** Directory holding the provider sources, or "" / "off" to skip it. */
  home?: string;
  /** Base URL of a companion provider service, if one is run instead. */
  url?: string;
  exists?: (path: string) => boolean;
  /** Resolves links, because the runtime it is handed to does not. */
  real?: (path: string) => string;
}

/**
 * The `--extractor-args` yt-dlp needs to reach whichever provider is present.
 * The script provider is only offered once its entry point is really on disk:
 * naming a missing one makes yt-dlp complain on every single call.
 */
export function potProviderArgs(environment: PotProviderEnvironment = {}): string[] {
  const {
    home = process.env.POT_PROVIDER_HOME ?? DEFAULT_POT_PROVIDER_HOME,
    url = process.env.POT_PROVIDER_URL ?? "",
    exists = existsSync,
    real = (path: string) => { try { return realpathSync(path); } catch { return path; } },
  } = environment;
  const args: string[] = [];
  const trimmedUrl = url.trim();
  if (trimmedUrl) args.push("--extractor-args", `youtubepot-bgutilhttp:base_url=${trimmedUrl}`);
  const trimmedHome = home.trim();
  if (trimmedHome && trimmedHome !== "off" && exists(join(trimmedHome, "src", "generate_once.ts"))) {
    // The real directory, not a link to it: the script is run under a runtime
    // whose file permissions are granted per path, and it compares the path it
    // resolves against the one it was granted. A link makes those differ, and
    // the script dies reading its own dependencies.
    args.push("--extractor-args", `youtubepot-bgutilscript:server_home=${real(trimmedHome)}`);
  }
  return args;
}

/** Resolved once: the answer cannot change without restarting the process. */
const POT_PROVIDER_ARGS: string[] = potProviderArgs();

/**
 * The arguments every attempt carries, however it authenticates.
 *
 * A token used to be what an unrecognised caller offered in place of an
 * account, so an attempt carrying cookies went without: measured on a refused
 * address, cookies alone answered in 4.5 s where cookies and a token took 6.0
 * for the same answer, and a second and a half on every track is worth having.
 *
 * That measurement has been overtaken. YouTube now challenges the player API
 * of a signed-in caller too — the same jar that loads a watch page perfectly
 * gets "Sign in to confirm you're not a bot" from yt-dlp — and the one thing
 * that might answer the challenge was the thing being withheld, precisely
 * because an account was present. A second and a half is worth having; it is
 * not worth a video that will not play.
 */
export function potArgsFor(_useCookies?: boolean): string[] {
  return POT_PROVIDER_ARGS;
}

/** The script provider's home, when the bundled script is the one in use. */
function scriptProviderHome(): string | null {
  const home = (process.env.POT_PROVIDER_HOME ?? DEFAULT_POT_PROVIDER_HOME).trim();
  if (!home || home === "off") return null;
  if (!existsSync(join(home, "src", "generate_once.ts"))) return null;
  try {
    return realpathSync(home);
  } catch {
    return home;
  }
}

/**
 * A token computed before anyone is waiting for it.
 *
 * Computing one is a small browser challenge: it runs a JavaScript engine and
 * takes seconds. Paying that in the middle of the first track of the day is
 * the worst possible moment, and it is avoidable — a token is about the
 * caller, not about a video, so nothing needs to be playing to obtain one.
 * The provider caches what it computes, so this is the only slow one.
 *
 * Warmed when the app starts and again when someone opens a page, at most
 * once in a while: browsing keeps it fresh at no cost, and an instance nobody
 * uses stops paying for it.
 */
const WARM_INTERVAL_MS = 30 * 60_000;

export function createPotProviderWarmer({
  home = scriptProviderHome(),
  now = Date.now,
  intervalMs = WARM_INTERVAL_MS,
  spawn = Bun.spawn,
  onWarmed = () => {},
}: {
  home?: string | null;
  now?: () => number;
  intervalMs?: number;
  spawn?: typeof Bun.spawn;
  onWarmed?: (ms: number) => void;
} = {}) {
  let lastWarmedAt = 0;
  let inFlight = false;

  return function warmPotProvider(): void {
    if (!home || inFlight || (lastWarmedAt > 0 && now() - lastWarmedAt < intervalMs)) return;
    inFlight = true;
    const startedAt = now();
    void (async () => {
      try {
        const process = spawn([
          "deno", "run",
          "--allow-env", "--allow-net", "--allow-read", "--allow-write", "--allow-ffi", "--allow-sys",
          join(home, "src", "generate_once.ts"),
        ], { cwd: home, stdout: "ignore", stderr: "ignore", env: { ...Bun.env, DENO_NO_PROMPT: "1" } });
        const timer = setTimeout(() => { try { process.kill(); } catch {} }, 60_000);
        const exitCode = await process.exited;
        clearTimeout(timer);
        if (exitCode === 0) {
          lastWarmedAt = now();
          onWarmed(now() - startedAt);
        }
      } catch {
        // A provider that cannot be run is not worth reporting on every page.
      } finally {
        inFlight = false;
      }
    })();
  };
}

/** The process-wide warmer: opening a page is enough to keep a token ready. */
export const warmPotProvider = createPotProviderWarmer({
  onWarmed: (ms) => log.info("ytdlp.pot_warmed", { ms }),
});
