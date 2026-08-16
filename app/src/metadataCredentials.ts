import { database } from "./database";
import { downloadCookiesConfigured } from "./downloadConfig";
import { log } from "./logger";
import type { VideoInfo } from "./youtube";
import { fetchVideoInfoViaYtdlp } from "./videoInfoViaYtdlp";

/**
 * The credentials the instance's own jobs may fall back on.
 *
 * Opening a video already does this: the import tries the plain request, and
 * when YouTube refuses the address it asks again through yt-dlp with the
 * profile's cookies. The background jobs never learned the second half, so on
 * a refused address the metadata backfill spent one lookup per batch being
 * told to sign in and gave up on the other nineteen — every three minutes, for
 * as long as the refusal lasted.
 *
 * There is no profile behind a scheduled job, so it borrows one: the primary
 * profile if it has a cookie jar, otherwise the first profile that does. That
 * makes the work attributable to one person's YouTube account, which is why it
 * is only ever a fallback — the anonymous request is still what is tried first,
 * and a profile that wants no part of it simply has no jar.
 */
export async function metadataCredentialProfile(): Promise<number | null> {
  const users = await database.prepare("SELECT id FROM users ORDER BY id ASC").all() as { id: number }[];
  return users.find((user) => downloadCookiesConfigured(user.id))?.id ?? null;
}

/**
 * How many authenticated lookups one batch may spend.
 *
 * yt-dlp costs about five seconds against one for a plain request, so a batch
 * of twenty would take two minutes if every one of them fell back. Three is
 * enough to keep a backlog moving without a scheduled job holding the runtime
 * for that long; the rest wait for the next batch, as they did before.
 */
export const AUTHENTICATED_LOOKUPS_PER_BATCH = 3;

export interface LookupBudget {
  remaining: number;
}

export function lookupBudget(size = AUTHENTICATED_LOOKUPS_PER_BATCH): LookupBudget {
  return { remaining: size };
}

/**
 * Ask again as somebody, when asking as nobody was refused.
 *
 * Returns null when there is nothing to try — no jar, no budget left, or a
 * failure that says something other than "we do not know you", since a private
 * or deleted video answers the same however it is asked.
 */
export async function fetchVideoInfoAsProfile(
  videoId: string,
  budget: LookupBudget,
  load = fetchVideoInfoViaYtdlp,
  profile = metadataCredentialProfile,
): Promise<VideoInfo | null> {
  if (budget.remaining <= 0) return null;
  const userId = await profile();
  if (userId == null) return null;
  budget.remaining--;
  const info = await load(userId, videoId).catch(() => null);
  if (info) log.info("video.metadata_via_credentials", { videoId, userId });
  return info;
}
