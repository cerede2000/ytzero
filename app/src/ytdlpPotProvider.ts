import { existsSync } from "node:fs";
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
export const DEFAULT_POT_PROVIDER_HOME = "/opt/bgutil-ytdlp-pot-provider/server";

export interface PotProviderEnvironment {
  /** Directory holding the provider sources, or "" / "off" to skip it. */
  home?: string;
  /** Base URL of a companion provider service, if one is run instead. */
  url?: string;
  exists?: (path: string) => boolean;
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
  } = environment;
  const args: string[] = [];
  const trimmedUrl = url.trim();
  if (trimmedUrl) args.push("--extractor-args", `youtubepot-bgutilhttp:base_url=${trimmedUrl}`);
  const trimmedHome = home.trim();
  if (trimmedHome && trimmedHome !== "off" && exists(join(trimmedHome, "src", "generate_once.ts"))) {
    args.push("--extractor-args", `youtubepot-bgutilscript:server_home=${trimmedHome}`);
  }
  return args;
}

/** Resolved once: the answer cannot change without restarting the process. */
export const POT_PROVIDER_ARGS: string[] = potProviderArgs();

/** Whether a provider is configured at all, for the runtime status panel. */
export const potProviderConfigured = POT_PROVIDER_ARGS.length > 0;
