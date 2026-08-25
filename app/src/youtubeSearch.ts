import { decodeHtmlEntities } from "./htmlEntities";
import { log } from "./logger";
import { readYouTubeResponse } from "./youtubeRateLimit";
import { sapisidFrom, sapisidHash } from "./youtubeInnerTube";
import type { ChannelSearchResult, PublishedAgo, SearchResult } from "./youtube";
import { readCount } from "./countText";
import { parseCompactCount, type PanelLanguage } from "./relatedVideoText";

interface YoutubeSearchDependencies {
  requestHeaders: (userId?: number) => Record<string, string>;
  resolveCacheKey: (userId?: number) => string;
  cleanSubscriberCount: (text: string) => string;
  deepCollect: (node: any, key: string, out?: any[]) => any[];
  extractInitialData: (html: string) => any | null;
  isSubscriberText: (text: string) => boolean;
  isVideoCountText: (text: string) => boolean;
  isViewCountText: (text: string) => boolean;
  parsePublishedTimeText: (text: string | undefined) => PublishedAgo | null;
}

/**
 * Parse a view or subscriber count returned by YouTube.
 *
 * The reading itself is in `countText`, which knows every magnitude the four
 * languages write and every way they group thousands. This name stays because
 * it is what the rest of the file and its tests call.
 */
export function parseAbbreviatedCount(text: string): number | null {
  return readCount(text);
}

/**
 * Who a walk belongs to.
 *
 * A signed-in search is ranked for that account, so a walk made with one
 * reader's jar must never answer another's question, nor the anonymous one.
 * The key is the reader, never the cookie: it is compared, held in memory and
 * potentially logged, and a credential has no business in any of that.
 */
export function walkKey(query: string, reader: number | null): string {
  return `${reader ?? "personne"}\u0000${query}`;
}

export function createYoutubeSearch(dependencies: YoutubeSearchDependencies) {
  const {
    requestHeaders,
    resolveCacheKey,
    cleanSubscriberCount,
    deepCollect,
    extractInitialData,
    isSubscriberText,
    isVideoCountText,
    isViewCountText,
    parsePublishedTimeText,
  } = dependencies;

const searchCache = new Map<string, { at: number; data: { results: SearchResult[]; channels: ChannelSearchResult[] } }>();
const SEARCH_TTL = 5 * 60_000;

/** Flatten every text part across a lockup's metadata rows. */
function lockupMetadataParts(vm: any): any[] {
  const rows = vm?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows ?? [];
  return rows.flatMap((row: any) => row?.metadataParts ?? []);
}

function bestSourceUrl(node: any): string {
  const group = deepCollect(node, "sources").find((sources: any) => Array.isArray(sources) && sources.some((source) => source?.url));
  return group?.at(-1)?.url ?? "";
}

// YouTube migrated search results from videoRenderer/channelRenderer to
// lockupViewModel cards; these read the new shape so results don't vanish when
// the (A/B-tested) new layout is served.
function searchVideoFromLockup(vm: any): SearchResult | null {
  if (vm?.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO" || !vm?.contentId) return null;
  const metadata = vm?.metadata?.lockupMetadataViewModel;
  const title = metadata?.title?.content;
  if (!title) return null;
  const parts = lockupMetadataParts(vm);
  const channelPart = parts.find((part: any) =>
    String(part?.text?.commandRuns?.[0]?.onTap?.innertubeCommand?.browseEndpoint?.browseId ?? "").startsWith("UC"));
  const viewPart = parts.find((part: any) => isViewCountText(String(part?.text?.content ?? "")));
  const published = parts
    .map((part: any) => parsePublishedTimeText(String(part?.text?.content ?? "")))
    .find((value: PublishedAgo | null) => value) ?? null;
  const badges = deepCollect(vm?.contentImage, "thumbnailBadgeViewModel").map((badge: any) => String(badge?.text ?? ""));
  return {
    videoId: vm.contentId,
    title: decodeHtmlEntities(title),
    thumbnail: bestSourceUrl(vm?.contentImage) || `https://i.ytimg.com/vi/${vm.contentId}/hqdefault.jpg`,
    duration: badges.find((text: string) => /^\d+(?::\d+)+$/.test(text)) ?? "",
    channelId: String(channelPart?.text?.commandRuns?.[0]?.onTap?.innertubeCommand?.browseEndpoint?.browseId ?? "") || null,
    channelTitle: decodeHtmlEntities(channelPart?.text?.content ?? ""),
    channelAvatar: bestSourceUrl(metadata?.image) || null,
    viewCount: viewPart ? parseAbbreviatedCount(String(viewPart.text.content)) : null,
    published,
  };
}

function searchChannelFromLockup(vm: any): ChannelSearchResult | null {
  if (!String(vm?.contentType ?? "").includes("CHANNEL")) return null;
  const channelId = String(vm?.contentId ?? "").startsWith("UC")
    ? vm.contentId
    : deepCollect(vm, "browseEndpoint").map((b: any) => b?.browseId).find((id: any) => typeof id === "string" && id.startsWith("UC"));
  if (!channelId) return null;
  const metadata = vm?.metadata?.lockupMetadataViewModel;
  const parts = lockupMetadataParts(vm).map((part: any) => String(part?.text?.content ?? ""));
  const rawThumbnail = bestSourceUrl(vm);
  return {
    channelId,
    title: decodeHtmlEntities(metadata?.title?.content ?? ""),
    thumbnail: rawThumbnail.startsWith("//") ? `https:${rawThumbnail}` : rawThumbnail,
    handle: parts.find((text) => text.startsWith("@")) ?? "",
    subscriberCount: cleanSubscriberCount(parts.find(isSubscriberText) ?? ""),
    videoCount: parts.find(isVideoCountText) ?? "",
  };
}

function collectSearchVideos(data: any): SearchResult[] {
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  for (const r of deepCollect(data, "videoRenderer")) {
    if (!r?.videoId || seen.has(r.videoId)) continue;
    seen.add(r.videoId);
    const viewStr = r?.viewCountText?.simpleText ?? r?.viewCountText?.runs?.[0]?.text ?? "";
    const viewNum = parseCompactCount(viewStr, countLanguage()) ?? NaN;
    out.push({
      videoId: r.videoId,
      title: decodeHtmlEntities(r.title?.runs?.[0]?.text ?? r.title?.simpleText ?? ""),
      thumbnail: r.thumbnail?.thumbnails?.at(-1)?.url ?? `https://i.ytimg.com/vi/${r.videoId}/hqdefault.jpg`,
      duration: r.lengthText?.simpleText ?? "",
      channelId: String(
        r.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
        ?? r.shortBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
        ?? "",
      ) || null,
      channelTitle: decodeHtmlEntities(r.shortBylineText?.runs?.[0]?.text ?? ""),
      channelAvatar: r.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer
        ?.thumbnail?.thumbnails?.at(-1)?.url ?? null,
      viewCount: viewStr ? parseAbbreviatedCount(viewStr) : null,
      published: parsePublishedTimeText(r.publishedTimeText?.simpleText),
    });
  }
  for (const vm of deepCollect(data, "lockupViewModel")) {
    const video = searchVideoFromLockup(vm);
    if (video && !seen.has(video.videoId)) {
      seen.add(video.videoId);
      out.push(video);
    }
  }
  return out;
}

function collectSearchChannels(data: any): ChannelSearchResult[] {
  const channels: ChannelSearchResult[] = [];
  const seen = new Set<string>();
  for (const r of deepCollect(data, "channelRenderer")) {
    if (!r?.channelId || seen.has(r.channelId)) continue;
    seen.add(r.channelId);
    const metadata = [r.shortBylineText, r.subscriberCountText, r.videoCountText]
      .map((value) => String(value?.simpleText ?? value?.runs?.map((part: any) => part.text).join("") ?? ""));
    const rawThumbnail = r.thumbnail?.thumbnails?.at(-1)?.url ?? "";
    channels.push({
      channelId: r.channelId,
      title: decodeHtmlEntities(r.title?.simpleText ?? r.title?.runs?.[0]?.text ?? ""),
      thumbnail: rawThumbnail.startsWith("//") ? `https:${rawThumbnail}` : rawThumbnail,
      handle: metadata.find((text) => text.startsWith("@")) ?? "",
      subscriberCount: cleanSubscriberCount(metadata.find(isSubscriberText) ?? ""),
      videoCount: metadata.find(isVideoCountText) ?? "",
    });
  }
  for (const vm of deepCollect(data, "lockupViewModel")) {
    const channel = searchChannelFromLockup(vm);
    if (channel && !seen.has(channel.channelId)) {
      seen.add(channel.channelId);
      channels.push(channel);
    }
  }
  return channels;
}

async function fetchSearchData(query: string, filter = "", userId?: number): Promise<any | null> {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}${filter}`;
  const res = await fetch(url, { headers: requestHeaders(userId) });
  if (!res.ok) throw new Error(`YouTube search failed (${res.status})`);
  return extractInitialData(await res.text());
}

// YouTube's "Channel" search filter (sp=EgIQAg%3D%3D). The default results page
// increasingly leads with video cards and omits the channel entirely, so we
// re-query with this filter when no channel surfaced.
const SEARCH_CHANNEL_FILTER = "&sp=EgIQAg%3D%3D";

async function searchYouTube(query: string, userId?: number): Promise<{ results: SearchResult[]; channels: ChannelSearchResult[] }> {
  const cacheKey = `${resolveCacheKey(userId)}:${query}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SEARCH_TTL) return cached.data;

  const data = await fetchSearchData(query, "", userId);
  if (!data) throw new Error("YouTube search returned no data (bot challenge or layout change)");

  const results = collectSearchVideos(data);
  let channels = collectSearchChannels(data);

  // The default layout often drops the channel card for channel-name queries;
  // a channel-filtered follow-up reliably brings it back.
  if (channels.length === 0) {
    try {
      const channelData = await fetchSearchData(query, SEARCH_CHANNEL_FILTER, userId);
      if (channelData) channels = collectSearchChannels(channelData);
    } catch {
      // Keep the (empty) channel list rather than failing the whole search.
    }
  }

  const result = { results: results.slice(0, 20), channels: channels.slice(0, 10) };
  searchCache.set(cacheKey, { at: Date.now(), data: result });
  return result;
}

// ---------- search suggestions (autocomplete) ----------
// YouTube's own suggestion service. The `client=firefox` flavour answers with
// plain JSON — ["typed", ["suggestion", ...], ...] — rather than the JSONP the
// web player uses, so nothing has to be unwrapped. `hl` follows the UI language
// so a German install gets German completions.

const suggestCache = new Map<string, { at: number; data: string[] }>();
const SUGGEST_TTL = 5 * 60_000;
const SUGGEST_TIMEOUT_MS = 3_000;
// One entry per prefix typed, so this grows far faster than the search cache:
// keep it bounded instead of letting a long session accumulate every keystroke.
const SUGGEST_CACHE_MAX = 500;

const SUGGEST_MAX = 10;

/** `limit` only trims the answer, so the cache stays valid when it changes. */
async function fetchSearchSuggestions(query: string, language = "en", limit = SUGGEST_MAX): Promise<string[]> {
  const take = Math.max(1, Math.min(SUGGEST_MAX, Math.trunc(limit) || SUGGEST_MAX));
  const key = `${language}\u0000${query}`;
  const cached = suggestCache.get(key);
  if (cached && Date.now() - cached.at < SUGGEST_TTL) return cached.data.slice(0, take);

  const url = "https://suggestqueries.google.com/complete/search"
    + `?client=firefox&ds=yt&hl=${encodeURIComponent(language)}&q=${encodeURIComponent(query)}`;
  // Suggestions are a nicety typed against: never let one hang the search box.
  const res = await fetch(url, { headers: fetchHeaders(), signal: AbortSignal.timeout(SUGGEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`YouTube suggestions failed (${res.status})`);
  const payload = JSON.parse(await res.text());
  const data = (Array.isArray(payload?.[1]) ? payload[1] : [])
    .filter((entry: unknown): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .slice(0, SUGGEST_MAX);

  if (suggestCache.size >= SUGGEST_CACHE_MAX) suggestCache.clear();
  suggestCache.set(key, { at: Date.now(), data });
  return data.slice(0, take);
}

  return { collectSearchVideos, fetchSearchSuggestions, searchChannelFromLockup, searchDeeper, searchVideoFromLockup, searchYouTube };
}
