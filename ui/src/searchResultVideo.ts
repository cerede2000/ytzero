import type { DownloadStatus, PublishedAgo, SearchResult, Video } from "./apiTypes";

const UNIT_MS: Record<PublishedAgo["unit"], number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_629_800_000,
  year: 31_557_600_000,
};

/**
 * When a search result was published, as near as YouTube will say.
 *
 * Search answers with "2 years ago" and nothing more precise, so the date is
 * reconstructed from it. It is marked approximate for the same reason: it is
 * accurate to the width of the unit it was given in, no further.
 */
export function approximatePublishedAt(published: PublishedAgo | null, now: number): string | null {
  if (!published) return null;
  return new Date(now - published.value * UNIT_MS[published.unit]).toISOString();
}

/**
 * A search result described as the video it is.
 *
 * The card that shows a result is the card that shows everything else, and it
 * asks for a library video. Everything it needs is already in the answer to
 * the search, so this is a rename rather than a lookup: browsing results costs
 * no requests, and the import each action needs is paid for by that action.
 */
export function videoFromSearchResult(
  result: SearchResult,
  context: { downloadsEnabled: boolean; downloadsAllowed: boolean; now: number },
): Video {
  return {
    video_id: result.videoId,
    channel_id: result.channelId ?? "",
    title: result.title,
    description: "",
    thumbnail: result.thumbnail,
    published_at: approximatePublishedAt(result.published, context.now),
    found_at: "",
    published_at_approximate: 1,
    members_only: 0,
    is_private: 0,
    live_status: "none",
    status: "inbox",
    bucket: null,
    show_from: null,
    is_short: 0,
    views: result.viewCount,
    likes: null,
    duration: result.duration || null,
    watch_position: result.watch_position,
    watch_duration: result.watch_duration,
    in_history: 0,
    external: 1,
    liked: 0,
    watched: result.watched,
    channel_title: result.channelTitle,
    channel_thumbnail: result.channelAvatar,
    channel_subscriber_count: null,
    download_status: (result.download_status ?? null) as DownloadStatus | null,
    // Carried through so an action on this card knows whether it must import
    // first. Dropped here, every action had to assume the worst.
    in_library: result.in_library,
    downloads_enabled: context.downloadsEnabled,
    downloads_allowed: context.downloadsAllowed,
    tags: [],
  };
}
