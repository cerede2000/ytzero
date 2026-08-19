import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The proof a media link carries in place of a session.
 *
 * Kept apart from the rest so it can be exercised without a database: this is
 * the part where a mistake means either broken playback or an open door.
 */
export const TOKEN_TTL_SECONDS = 6 * 60 * 60;

/**
 * The signature covers what the link is for as well as which video.
 *
 * Without the resource in it, the token minted for a video's stream would open
 * its subtitles too, and every later kind of link we add would be openable by
 * any token ever issued.
 */
export function mediaSignature(secret: string, resource: string, videoId: string, expires: number): string {
  return createHmac("sha256", secret).update(`${resource}:${videoId}:${expires}`).digest("hex");
}

/** Constant-time, and false rather than throwing on anything malformed. */
export function mediaTokenValid(
  secret: string,
  resource: string,
  videoId: string,
  expires: string | undefined,
  signature: string | undefined,
  now: number = Date.now(),
): boolean {
  const deadline = Number(expires);
  if (!Number.isFinite(deadline) || deadline * 1000 < now) return false;
  if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = mediaSignature(secret, resource, videoId, deadline);
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
}
