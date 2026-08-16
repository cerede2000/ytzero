import { decodeHtmlEntities } from "./htmlEntities";
import type { PublishedAgo } from "./youtube";

/**
 * The videos YouTube itself puts beside the one being watched.
 *
 * They arrive in `ytInitialData` on the watch page — the same page
 * `fetchVideoInfo` already downloads to read the player response, and then
 * throws away. Reading them costs nothing beyond the parsing: no second
 * request, no yt-dlp, no search.
 *
 * The card is not the one search returns, so it is not read by the same
 * function. A related lockup names its channel in a metadata row with no
 * browse endpoint behind it, and abbreviates what search spells out: "699K"
 * where search says "699K views", "1mo ago" where search says "1 month ago".
 */
export interface RelatedVideo {
  videoId: string;
  title: string;
  thumbnail: string;
  duration: string;
  channelId: string | null;
  channelTitle: string;
  channelAvatar: string | null;
  viewCount: number | null;
  published: PublishedAgo | null;
}

/** A bare count as the side panel writes it: "539", "1.6M", "12M". */
const COUNT = /^[\d.,]+\s*[KMB]?$/i;
/** "1mo ago", "3w ago", "15y ago" — the panel's own shorthand. */
const AGO = /^(\d+)\s*(mo|s|m|h|d|w|y)\s*ago$/i;
const UNITS: Record<string, PublishedAgo["unit"]> = {
  s: "second", m: "minute", h: "hour", d: "day", w: "week", mo: "month", y: "year",
};

export function parseCompactPublishedText(text: string | undefined): PublishedAgo | null {
  const match = text?.trim().match(AGO);
  // "mo" is tried before "m" by the alternation above; reading them the other
  // way round turns three months old into three minutes old.
  if (!match) return null;
  const unit = UNITS[match[2].toLowerCase()];
  return unit ? { value: parseInt(match[1], 10), unit } : null;
}

export function parseCompactCount(text: string | undefined): number | null {
  if (!text || !COUNT.test(text.trim())) return null;
  const match = text.replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  const multiplier = { k: 1e3, m: 1e6, b: 1e9 }[(match[2] ?? "").toLowerCase()] ?? 1;
  const total = Math.round(value * multiplier);
  return total > 0 ? total : null;
}

function collect(node: any, key: string, out: any[] = []): any[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) collect(item, key, out);
    return out;
  }
  for (const [name, value] of Object.entries(node)) {
    if (name === key) out.push(value);
    collect(value, key, out);
  }
  return out;
}

function bestSourceUrl(node: any): string {
  const group = collect(node, "sources").find((sources: any) => Array.isArray(sources) && sources.some((source) => source?.url));
  const url = group?.at(-1)?.url ?? "";
  return url.startsWith("//") ? `https:${url}` : url;
}

export function relatedFromLockup(vm: any): RelatedVideo | null {
  if (vm?.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO" || typeof vm?.contentId !== "string") return null;
  const metadata = vm?.metadata?.lockupMetadataViewModel;
  const title = metadata?.title?.content;
  if (!title) return null;

  const rows = metadata?.metadata?.contentMetadataViewModel?.metadataRows ?? [];
  const parts = rows.flatMap((row: any) => row?.metadataParts ?? []);
  const texts: string[] = parts.map((part: any) => String(part?.text?.content ?? "")).filter(Boolean);
  // The channel is whichever part is neither a count nor an age. Naming it by
  // what it is not is what makes this survive a row order that moves.
  const channelTitle = texts.find((text) => !COUNT.test(text) && !AGO.test(text)) ?? "";
  const badges = collect(vm?.contentImage, "thumbnailBadgeViewModel").map((badge: any) => String(badge?.text ?? ""));

  return {
    videoId: vm.contentId,
    title: decodeHtmlEntities(String(title)),
    thumbnail: bestSourceUrl(vm?.contentImage) || `https://i.ytimg.com/vi/${vm.contentId}/hqdefault.jpg`,
    duration: badges.find((text: string) => /^\d+(?::\d+)+$/.test(text)) ?? "",
    channelId: String(
      parts.map((part: any) => part?.text?.commandRuns?.[0]?.onTap?.innertubeCommand?.browseEndpoint?.browseId)
        .find((id: unknown) => typeof id === "string" && id.startsWith("UC")) ?? "",
    ) || null,
    channelTitle: decodeHtmlEntities(channelTitle),
    channelAvatar: bestSourceUrl(metadata?.image) || null,
    viewCount: parseCompactCount(texts.find((text) => COUNT.test(text))),
    published: parseCompactPublishedText(texts.find((text) => AGO.test(text))),
  };
}

/**
 * Which suggestions the panel should carry, and in what order.
 *
 * YouTube's order is the recommendation, so it is kept. What is dropped is
 * what would read as a repetition: the video being watched, and — when asked —
 * the ones the library already has, since those reach the same panel again
 * through its own matching a few entries further down.
 */
export function selectRelatedForPanel(
  videos: readonly RelatedVideo[],
  options: { limit: number; currentVideoId: string; inLibrary?: ReadonlySet<string>; hideKnown?: boolean },
): RelatedVideo[] {
  if (options.limit <= 0) return [];
  return videos
    .filter((video) => video.videoId !== options.currentVideoId)
    .filter((video) => !(options.hideKnown && options.inLibrary?.has(video.videoId)))
    .slice(0, options.limit);
}

/**
 * Read the side panel out of a watch page.
 *
 * Only `secondaryResults` is searched, so nothing from the player, the
 * comments or the end screen can be mistaken for a suggestion.
 */
export function relatedVideosFromWatchPage(initialData: unknown, limit = 40): RelatedVideo[] {
  const secondary = collect(initialData, "secondaryResults");
  if (secondary.length === 0) return [];
  const seen = new Set<string>();
  const videos: RelatedVideo[] = [];
  for (const lockup of collect(secondary, "lockupViewModel")) {
    const video = relatedFromLockup(lockup);
    if (!video || seen.has(video.videoId)) continue;
    seen.add(video.videoId);
    videos.push(video);
    if (videos.length >= limit) break;
  }
  return videos;
}
