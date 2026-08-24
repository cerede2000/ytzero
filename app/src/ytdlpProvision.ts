import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { YTDLP, invalidateYtdlpStatus } from "./downloadConfig";
import { log } from "./logger";

/**
 * Put yt-dlp where this instance has been told to look for it.
 *
 * The binary lives on the persistent volume so that its self-updates survive a
 * new image, and the copy in the image is only a bootstrap for a volume that
 * has never had one. The container's command does that copy — and a container
 * whose command was replaced, or which was built into a stack before that
 * command existed, starts with `YTDLP_PATH` pointing at a file nobody ever
 * wrote. Downloads stop, transcripts stop, and the reason is a shell script
 * that did not run.
 *
 * So the server does it too, on the way up. It is the same decision the script
 * makes, and it is idempotent: where the script has already run, this finds the
 * file and does nothing at all.
 */
export const MANAGED_PATH = process.env.YTDLP_MANAGED_PATH ?? "/data/bin/yt-dlp";
export const BOOTSTRAP_PATH = process.env.YTDLP_BOOTSTRAP_PATH ?? "/usr/local/bin/yt-dlp";

export type ProvisionVerdict = "copy" | "already-there" | "not-managed" | "no-bootstrap";

/**
 * Whether to write the managed binary, given what is on disk.
 *
 * `not-managed` is the operator's own `YTDLP_PATH`: they have said where their
 * yt-dlp is, and writing somewhere else would be answering a question they did
 * not ask.
 */
export function provisionVerdict(
  configuredPath: string,
  managedExists: boolean,
  bootstrapExists: boolean,
  managed: string = MANAGED_PATH,
): ProvisionVerdict {
  if (configuredPath !== managed) return "not-managed";
  if (managedExists) return "already-there";
  if (!bootstrapExists) return "no-bootstrap";
  return "copy";
}

export function provisionManagedYtdlp(): void {
  const verdict = provisionVerdict(YTDLP, existsSync(MANAGED_PATH), existsSync(BOOTSTRAP_PATH));
  if (verdict !== "copy") {
    // Only the case that needs saying: told to use a managed binary, and
    // neither it nor anything to make it from is there.
    if (verdict === "no-bootstrap") log.warn("ytdlp.provision_impossible", { managed: MANAGED_PATH, bootstrap: BOOTSTRAP_PATH });
    return;
  }
  try {
    mkdirSync(dirname(MANAGED_PATH), { recursive: true });
    copyFileSync(BOOTSTRAP_PATH, MANAGED_PATH);
    chmodSync(MANAGED_PATH, 0o755);
    // The same marker the script leaves, so the first update still reconciles
    // the stored channel rather than assuming this copy is the wanted one.
    const marker = process.env.YTDLP_PROVISION_MARKER;
    if (marker) writeFileSync(marker, "");
    invalidateYtdlpStatus();
    log.info("ytdlp.provisioned", { managed: MANAGED_PATH, from: BOOTSTRAP_PATH });
  } catch (error) {
    log.error("ytdlp.provision_failed", { managed: MANAGED_PATH, error: error instanceof Error ? error.message : String(error) });
  }
}
