import type { SearchResult, Video } from "./apiTypes";
import { videoFromSearchResult } from "./searchResultVideo";

/**
 * The panel beside a video, once YouTube has said what belongs there.
 *
 * The library builds its own list as a waterfall: videos sharing a tag, then
 * the rest of the channel, then any channel sharing a tag, then simply what
 * arrived recently. Its last two steps answer "what else is here", not "what
 * goes with this" — and they run to a target of fifteen whether or not YouTube
 * has answered.
 *
 * So the suggestions replace that list rather than lead it. Prepending them
 * left a panel that opened on YouTube's answer and continued, below the fold,
 * into fifteen videos picked for being recent: the suggestions were right, and
 * the panel still read as the library's.
 *
 * The waterfall keeps the job it always had — a video YouTube offers nothing
 * for, and a panel deliberately kept local by setting the count to zero.
 */
export function withSuggestions(
  local: Video[],
  suggested: SearchResult[] | undefined,
  // What this profile may do with a suggestion. Hard-coded to false here, the
  // panel could never offer to download one — the one list in the app where a
  // card was drawn without the actions that card carries everywhere else.
  downloads: { allowed?: boolean; enabled?: boolean } = {},
): Video[] {
  if (!suggested?.length) return local;
  const now = Date.now();
  // They are not library rows — nothing was imported to show them — but the
  // card the panel draws reads a video, and a search result already knows how
  // to become one. Acting on a suggestion imports it, exactly as in search.
  return suggested.map((result) => videoFromSearchResult(result, {
    downloadsAllowed: downloads.allowed === true,
    downloadsEnabled: downloads.enabled === true,
    now,
  }));
}
