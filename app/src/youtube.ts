import { XMLParser } from "fast-xml-parser";
import { createRequire } from "module";
import { decodeHtmlEntities } from "./htmlEntities";
import { createYoutubeSearch, parseAbbreviatedCount } from "./youtubeSearch";
import { isYouTubeRateLimitError, isYouTubeRefusalError, readYouTubeResponse, youtubeRefusalGate } from "./youtubeRateLimit";
import { DeletedVideoError, fetchVideoOEmbedAvailability, isDeletedVideoError, isPrivateVideoError, PrivateVideoError } from "./youtubeVideoAvailability";
import { videoInfoRefusalQuiet, YouTubeRefusingError } from "./youtubeRefusalQuiet";
import { relatedVideosFromWatchPage, type RelatedVideo } from "./relatedVideos";
import { acceptLanguage, parseCompactCount, parsePublishedTextAnyLanguage, type PanelLanguage } from "./relatedVideoText";
import { libraryLanguage } from "./libraryLanguage";
import { languageHeaders } from "./youtubeLanguageCookie";
import { inferIsShortFromMetadata } from "./shortClassification";
import { resolveYouTubeLanguage, youtubeRequestHeaders, youtubeRssHeaders, type ResolvedYouTubeLanguage } from "./youtubeRequestLanguage";
export { DeletedVideoError, fetchVideoOEmbed, fetchVideoOEmbedAvailability, isDeletedVideoError, isPrivateVideoError, PrivateVideoError, videoOEmbedAvailabilityFromStatus } from "./youtubeVideoAvailability";
const _require = createRequire(import.meta.url);
const InnerTubeClient = _require("innertube.js");
const _yt = new InnerTubeClient();

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

export interface FeedVideo {
  videoId: string;
  title: string;
  description: string;
  thumbnail: string;
  publishedAt: string;
  views: number | null;
  likes: number | null;
  channelId?: string;
  channelTitle?: string;
}

export interface ChannelFeed {
  channelId: string;
  channelTitle: string;
  videos: FeedVideo[];
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export async function fetchChannelFeed(channelId: string, userId?: number): Promise<ChannelFeed> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const res = await fetch(url, { headers: youtubeRssHeaders(userId) });
  const doc = xml.parse(await readYouTubeResponse(res, `RSS fetch failed for ${channelId}`));
  const feed = doc.feed ?? {};
  const videos: FeedVideo[] = asArray(feed.entry).map((e: any) => {
    const community = e["media:group"]?.["media:community"];
    const views = Number(community?.["media:statistics"]?.["@_views"]);
    const likes = Number(community?.["media:starRating"]?.["@_count"]);
    return {
      videoId: e["yt:videoId"] ?? "",
      title: decodeHtmlEntities(String(e.title ?? "")),
      description: String(e["media:group"]?.["media:description"] ?? ""),
      thumbnail:
        e["media:group"]?.["media:thumbnail"]?.["@_url"] ??
        `https://i.ytimg.com/vi/${e["yt:videoId"]}/hqdefault.jpg`,
      publishedAt: e.published ?? "",
      views: Number.isFinite(views) ? views : null,
      likes: Number.isFinite(likes) ? likes : null,
      channelId,
      channelTitle: decodeHtmlEntities(String(feed.title ?? "")),
    };
  });
  return {
    channelId,
    channelTitle: decodeHtmlEntities(String(feed.title ?? "")),
    videos: videos.filter((v) => v.videoId),
  };
}

/** Resolve any YouTube channel URL or @handle to a channel ID (UC...). */
export async function resolveChannelId(input: string, userId?: number): Promise<{ channelId: string; title: string; thumbnail: string }> {
  let url = input.trim();
  if (/^UC[\w-]{22}$/.test(url)) {
    url = `https://www.youtube.com/channel/${url}`;
  } else if (url.startsWith("@")) {
    url = `https://www.youtube.com/${url}`;
  } else if (!/^https?:\/\//.test(url)) {
    url = `https://www.youtube.com/${url.replace(/^\/+/, "")}`;
  }
  const res = await fetch(url, { headers: youtubeRequestHeaders(userId), redirect: "follow" });
  if (!res.ok) throw new Error(`Failed to fetch channel page (${res.status})`);
  const html = await res.text();
  // The canonical link is authoritative; "channelId" occurrences in page data
  // can belong to recommended channels.
  const idMatch =
    html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) ??
    html.match(/"channelId":"(UC[\w-]{22})"/);
  if (!idMatch) throw new Error("No channel ID found on page");
  const titleMatch = html.match(/<meta property="og:title" content="([^"]*)"/);
  const thumbMatch = html.match(/<meta property="og:image" content="([^"]*)"/);
  return {
    channelId: idMatch[1],
    title: decodeHtmlEntities(titleMatch?.[1] ?? ""),
    thumbnail: thumbMatch?.[1] ?? "",
  };
}

export interface LiveInfo {
  videoId: string;
  title: string;
  thumbnail: string;
  isLiveNow: boolean;
  isUpcoming: boolean;
}

/**
 * Scrape https://www.youtube.com/channel/<id>/live to detect a current or
 * upcoming livestream. Returns null when the channel is not live.
 */
export async function fetchLiveInfo(channelId: string, userId?: number): Promise<LiveInfo | null> {
  const res = await fetch(`https://www.youtube.com/channel/${channelId}/live`, {
    headers: youtubeRequestHeaders(userId),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`channel live request failed (${res.status})`);
  const html = await res.text();

  // When the channel has a live/upcoming stream, /live canonicalizes to the
  // watch page; otherwise it canonicalizes back to the channel page.
  const videoIdMatch = html.match(
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/
  );
  if (!videoIdMatch) return null;

  // "isLive":true is set only while the stream is actually broadcasting;
  // ended streams keep "isLiveContent":true but drop "isLive".
  const isUpcoming = /"isUpcoming"\s*:\s*true/.test(html);
  const isLiveNow = !isUpcoming && /"isLive"\s*:\s*true/.test(html);
  if (!isLiveNow && !isUpcoming) return null;
  // A channel's /live slot is held by its next scheduled stream, and a stream
  // that was never going to happen holds it for good: this page canonicalised
  // to a stream scheduled for July 2016 and still announced as upcoming ten
  // years later. Reported as active, it is re-announced on every refresh — so
  // the demotion that clears finished streams can never reach it.
  if (isUpcoming && isAbandonedSchedule(html.match(/"scheduledStartTime"\s*:\s*"?(\d+)"?/)?.[1])) return null;

  const titleMatch = html.match(/<meta name="title" content="([^"]*)"/);
  return {
    videoId: videoIdMatch[1],
    title: decodeHtmlEntities(titleMatch?.[1] ?? ""),
    thumbnail: `https://i.ytimg.com/vi/${videoIdMatch[1]}/hqdefault.jpg`,
    isLiveNow,
    isUpcoming: !isLiveNow && isUpcoming,
  };
}

/** Extract the ytInitialData JSON blob embedded in a YouTube page. */
function extractVariable(html: string, name: string): any | null {
  const marker = `${name} = `;
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  // Find the start of the JSON object/array.
  let start = idx + marker.length;
  const open = html[start];
  if (open !== "{" && open !== "[") return null;
  const close = open === "{" ? "}" : "]";
  // Brace-match while respecting string literals and escapes, because the
  // surrounding <script> can contain trailing JS after the JSON (e.g.
  // ytInitialPlayerResponse is followed by more code in the same tag).
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function extractInitialData(html: string): any | null {
  return extractVariable(html, "ytInitialData");
}

/** Collect every value stored under the given key anywhere in a JSON tree. */
function deepCollect(node: any, key: string, out: any[] = []): any[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) deepCollect(item, key, out);
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === key) out.push(v);
    deepCollect(v, key, out);
  }
  return out;
}

function isSubscriberText(text: string): boolean {
  return /(subscribers?|subskryb|abonn|suscrip|inscrito|iscritt)/i.test(text);
}

function isVideoCountText(text: string): boolean {
  return /\b(vid(?:e|é)os?|film(?:y|ów)?)\b/i.test(text);
}

function isViewCountText(text: string): boolean {
  return /(views?|wyświe|aufrufe|vues|visualizac|visualizz|reproduc)/i.test(text);
}

function cleanSubscriberCount(text: string): string {
  return text
    .replace(/subscribers?/gi, "")
    .replace(/subskrybent(?:ów|y)?/gi, "")
    .replace(/subskrypcji/gi, "")
    .replace(/abonn(?:és|enten)?/gi, "")
    .replace(/suscriptores?/gi, "")
    .replace(/inscritos?/gi, "")
    .replace(/iscritti/gi, "")
    .replace(/[•·]/g, "")
    .trim();
}

function cleanVideoCount(text: string): string {
  return text
    .replace(/\s*(videos?|vidéos?|film(?:y|ów)?)\s*/gi, "")
    .replace(/[•·]/g, "")
    .trim();
}

function textFromMetadataPart(part: any): string[] {
  return [part?.text?.content, part?.accessibilityLabel]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function extractHeaderStats(data: any): { subscriberCount: string; stats: string[] } {
  const pageHeader = deepCollect(data, "pageHeaderRenderer")[0];
  const headerMetadata = pageHeader?.content?.pageHeaderViewModel?.metadata?.contentMetadataViewModel;
  const metadataRows = Array.isArray(headerMetadata?.metadataRows) ? headerMetadata.metadataRows : [];
  const stats: string[] = [];
  let subscriberCount = "";

  for (const row of metadataRows) {
    for (const part of Array.isArray(row?.metadataParts) ? row.metadataParts : []) {
      const texts = textFromMetadataPart(part);
      const visible = texts[0] ?? "";
      const searchable = texts.join(" ");
      if (!visible || visible.length >= 80) continue;
      if (visible.startsWith("@")) continue;
      if (isSubscriberText(searchable)) {
        subscriberCount ||= cleanSubscriberCount(visible);
      } else if (isVideoCountText(searchable)) {
        stats.push(cleanVideoCount(visible));
      }
    }
  }

  if (subscriberCount || stats.length > 0) {
    return { subscriberCount, stats: [...new Set(stats.filter(Boolean))] };
  }

  const fallbackStats: string[] = [];
  for (const parts of deepCollect(data, "metadataParts")) {
    for (const part of Array.isArray(parts) ? parts : []) {
      const texts = textFromMetadataPart(part);
      const visible = texts[0] ?? "";
      const searchable = texts.join(" ");
      if (!visible || visible.length >= 80 || visible.startsWith("@")) continue;
      if (isSubscriberText(searchable)) subscriberCount ||= cleanSubscriberCount(visible);
      else if (isVideoCountText(searchable)) fallbackStats.push(cleanVideoCount(visible));
    }
    if (subscriberCount) break;
  }
  return { subscriberCount, stats: [...new Set(fallbackStats.filter(Boolean))] };
}

export interface ChannelLink {
  title: string;
  url: string;
}

export interface ChannelAbout {
  channelId: string;
  title: string;
  description: string;
  avatar: string;
  banner: string;
  subscriberCount: string;
  stats: string[];
  links: ChannelLink[];
  joinedDate: string;
  viewCount: string;
  handle: string;
}

export interface WatchSubscriberCount {
  subscriberCount: string;
  videoId: string;
  ownerChannelId: string;
  ownerTitle: string;
}

const aboutCache = new Map<string, { at: number; data: ChannelAbout }>();
const ABOUT_TTL = 10 * 60_000;

export async function fetchChannelAbout(channelId: string): Promise<ChannelAbout> {
  const cached = aboutCache.get(channelId);
  if (cached && Date.now() - cached.at < ABOUT_TTL) return cached.data;

  const data = await _yt.getChannel({ channelId });

  const meta = deepCollect(data, "channelMetadataRenderer")[0] ?? {};
  const avatar: string = meta.avatar?.thumbnails?.at(-1)?.url ?? "";
  const title = decodeHtmlEntities(String(meta.title ?? ""));
  const description: string = meta.description ?? "";
  const handle: string =
    (meta.vanityChannelUrl ?? "").replace(/^https?:\/\/www\.youtube\.com\//, "") ||
    (meta.ownerUrls?.[0] ?? "").replace(/^https?:\/\/www\.youtube\.com\//, "");

  const banner: string =
    deepCollect(data, "imageBannerViewModel")[0]?.image?.sources?.at(-1)?.url ?? "";

  const { subscriberCount, stats } = extractHeaderStats(data);

  const about: ChannelAbout = {
    channelId,
    title,
    description,
    avatar,
    banner,
    subscriberCount,
    stats: [...new Set(stats)],
    links: [],
    joinedDate: "",
    viewCount: "",
    handle,
  };
  aboutCache.set(channelId, { at: Date.now(), data: about });
  return about;
}

function extractSubscriberCountText(node: any): string {
  const simple = node?.simpleText;
  if (typeof simple === "string" && isSubscriberText(simple)) {
    return cleanSubscriberCount(simple);
  }
  const label = node?.accessibility?.accessibilityData?.label;
  if (typeof label === "string" && isSubscriberText(label)) {
    return cleanSubscriberCount(label);
  }
  return "";
}

export async function fetchVideoOwnerSubscriberCount(videoId: string, userId?: number): Promise<WatchSubscriberCount | null> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { headers: youtubeRequestHeaders(userId) });
  if (!res.ok) return null;
  const data = extractInitialData(await res.text());
  const owner = deepCollect(data, "videoOwnerRenderer")[0];
  if (!owner) return null;
  const subscriberCount = extractSubscriberCountText(owner.subscriberCountText);
  if (!subscriberCount) return null;
  return {
    subscriberCount,
    videoId,
    ownerChannelId: owner.navigationEndpoint?.browseEndpoint?.browseId ?? "",
    ownerTitle: decodeHtmlEntities(owner.title?.runs?.[0]?.text ?? owner.title?.simpleText ?? ""),
  };
}

export async function fetchChannelSubscriberCountFromWatch(channelId: string, userId?: number): Promise<WatchSubscriberCount | null> {
  const feed = await fetchChannelFeed(channelId, userId);
  for (const video of feed.videos.slice(0, 3)) {
    const result = await fetchVideoOwnerSubscriberCount(video.videoId, userId);
    if (result?.subscriberCount) return result;
  }
  return null;
}

export interface PlaylistInfo {
  playlistId: string;
  title: string;
  thumbnail: string;
  videoCount: string;
}

const playlistCache = new Map<string, { at: number; data: PlaylistInfo[]; complete: boolean }>();
const MAX_PLAYLIST_CONTINUATION_PAGES = 50;

function collectChannelPlaylists(data: any, out: PlaylistInfo[], seen: Set<string>) {
  // Legacy markup.
  for (const r of deepCollect(data, "gridPlaylistRenderer")) {
    if (!r?.playlistId || seen.has(r.playlistId)) continue;
    seen.add(r.playlistId);
    out.push({
      playlistId: r.playlistId,
      title: decodeHtmlEntities(r.title?.runs?.[0]?.text ?? r.title?.simpleText ?? ""),
      thumbnail: r.thumbnail?.thumbnails?.at(-1)?.url ?? "",
      videoCount: r.videoCountShortText?.simpleText ?? "",
    });
  }
  // Current markup (lockup view models).
  for (const vm of deepCollect(data, "lockupViewModel")) {
    const id = vm?.contentId;
    if (!id || seen.has(id) || !String(vm?.contentType ?? "").includes("PLAYLIST")) continue;
    seen.add(id);
    const badges = deepCollect(vm, "thumbnailBadgeViewModel")
      .map((b: any) => b?.text)
      .filter((t: any) => typeof t === "string");
    out.push({
      playlistId: id,
      title: decodeHtmlEntities(vm?.metadata?.lockupMetadataViewModel?.title?.content ?? ""),
      thumbnail: deepCollect(vm, "sources")[0]?.[0]?.url ?? "",
      videoCount: badges[0] ?? "",
    });
  }
}

/** Parse the playlists present in a channel page's initial payload. Exported
 * separately so YouTube layout changes can be covered with fixture tests. */
export function parseChannelPlaylistsHtml(html: string): PlaylistInfo[] {
  const out: PlaylistInfo[] = [];
  collectChannelPlaylists(extractInitialData(html), out, new Set<string>());
  return out;
}

export function playlistContinuationToken(data: any): string | null {
  for (const renderer of deepCollect(data, "continuationItemRenderer")) {
    const token = renderer?.continuationEndpoint?.continuationCommand?.token;
    if (typeof token === "string" && token) return token;
  }
  // Current view-model markup used by channel and playlist pages.
  for (const viewModel of deepCollect(data, "continuationItemViewModel")) {
    const token = viewModel?.continuationCommand?.innertubeCommand?.continuationCommand?.token
      ?? viewModel?.continuationEndpoint?.continuationCommand?.token;
    if (typeof token === "string" && token) return token;
  }
  return null;
}

function innertubePlaylistConfig(html: string): { apiKey: string; clientVersion: string } | null {
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  const clientVersion = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)?.[1];
  return apiKey && clientVersion ? { apiKey, clientVersion } : null;
}

export function playlistContinuationBody(token: string, clientVersion: string, language: string) {
  return {
    context: { client: { clientName: "WEB", clientVersion, hl: language, gl: "US" } },
    continuation: token,
  };
}

async function fetchPlaylistContinuation(token: string, config: { apiKey: string; clientVersion: string }, language: ResolvedYouTubeLanguage) {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/browse?prettyPrint=false&key=${encodeURIComponent(config.apiKey)}`, {
    method: "POST",
    headers: { ...youtubeRequestHeaders(language.userId, language), "Content-Type": "application/json", Origin: "https://www.youtube.com" },
    body: JSON.stringify(playlistContinuationBody(token, config.clientVersion, language.hl)),
  });
  return JSON.parse(await readYouTubeResponse(res, "playlist continuation fetch failed"));
}

export async function fetchChannelPlaylists(channelId: string, force = false, userId?: number): Promise<PlaylistInfo[]> {
  const language = resolveYouTubeLanguage(userId);
  const cacheKey = `${language.cacheKey}:${channelId}`;
  const cached = playlistCache.get(cacheKey);
  // Older versions cached only YouTube's first page (~30 cards). Re-fetch that
  // boundary case once so it is upgraded to a complete paginated result.
  if (!force && cached && cached.complete && Date.now() - cached.at < ABOUT_TTL) return cached.data;

  const res = await fetch(`https://www.youtube.com/channel/${channelId}/playlists`, {
    headers: youtubeRequestHeaders(userId, language),
  });
  const html = await readYouTubeResponse(res, "playlists fetch failed");
  const data = extractInitialData(html);
  const out: PlaylistInfo[] = [];
  const seen = new Set<string>();
  collectChannelPlaylists(data, out, seen);

  const config = innertubePlaylistConfig(html);
  let token = playlistContinuationToken(data);
  let complete = true;
  for (let page = 0; config && token && page < MAX_PLAYLIST_CONTINUATION_PAGES; page++) {
    const previousToken = token;
    try {
      const continuation = await fetchPlaylistContinuation(token, config, language);
      collectChannelPlaylists(continuation, out, seen);
      token = playlistContinuationToken(continuation);
      if (token === previousToken) break;
    } catch (error) {
      if (isYouTubeRateLimitError(error)) throw error;
      complete = false;
      break;
    }
  }
  if (token) complete = false;
  playlistCache.set(cacheKey, { at: Date.now(), data: out, complete });
  return out;
}

export interface PlaylistVideo {
  videoId: string;
  title: string;
  thumbnail: string;
  channelTitle: string;
  duration: string;
  index: number;
  channelId: string;
}

const playlistFeedCache = new Map<string, { at: number; data: PlaylistFeed }>();
const playlistVideosCache = new Map<string, { at: number; videos: PlaylistVideo[]; complete: boolean }>();

export interface PlaylistFeed {
  playlistId: string;
  title: string;
  /** Channel that owns the playlist (from the feed's top-level yt:channelId). */
  channelId: string;
  channelTitle: string;
  videos: FeedVideo[];
}

export interface VideoDuration { videoId: string; duration: string; }

export async function fetchChannelVideosDurations(channelId: string, userId?: number): Promise<VideoDuration[]> {
  const res = await fetch(`https://www.youtube.com/channel/${channelId}/videos`, { headers: youtubeRequestHeaders(userId) });
  if (!res.ok) return [];
  const data = extractInitialData(await res.text());
  const out: VideoDuration[] = [];
  for (const r of deepCollect(data, "videoRenderer")) {
    if (r?.videoId && r?.lengthText?.simpleText) {
      out.push({ videoId: r.videoId, duration: r.lengthText.simpleText });
    }
  }
  return out;
}

/**
 * Fetch a playlist via its RSS feed (`?playlist_id=`), which shares the Atom
 * format used by channel feeds. More reliable than scraping the playlist page,
 * but capped at ~15 entries and without per-video duration.
 */
export async function fetchPlaylistFeed(playlistId: string, force = false, userId?: number): Promise<PlaylistFeed> {
  const cacheKey = `${resolveYouTubeLanguage(userId).cacheKey}:${playlistId}`;
  const cached = playlistFeedCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.at < ABOUT_TTL) return cached.data;

  const url = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;
  const res = await fetch(url, { headers: youtubeRssHeaders(userId) });
  const doc = xml.parse(await readYouTubeResponse(res, "playlist feed fetch failed"));
  const feed = doc.feed ?? {};
  const videos: FeedVideo[] = asArray(feed.entry)
    .map((e: any): FeedVideo => {
      const community = e["media:group"]?.["media:community"];
      const views = Number(community?.["media:statistics"]?.["@_views"]);
      const likes = Number(community?.["media:starRating"]?.["@_count"]);
      const videoId = e["yt:videoId"] ?? "";
      return {
        videoId,
        title: decodeHtmlEntities(String(e["media:group"]?.["media:title"] ?? e.title ?? "")),
        description: String(e["media:group"]?.["media:description"] ?? ""),
        thumbnail:
          e["media:group"]?.["media:thumbnail"]?.["@_url"] ??
          `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        publishedAt: e.published ?? "",
        views: Number.isFinite(views) ? views : null,
        likes: Number.isFinite(likes) ? likes : null,
        channelId: String(e["yt:channelId"] ?? feed["yt:channelId"] ?? ""),
        channelTitle: decodeHtmlEntities(String(e.author?.name ?? feed.author?.name ?? "")),
      };
    })
    .filter((v) => v.videoId);

  const data: PlaylistFeed = {
    playlistId,
    title: decodeHtmlEntities(String(feed.title ?? "")),
    channelId: String(feed["yt:channelId"] ?? ""),
    channelTitle: decodeHtmlEntities(String(feed.author?.name ?? feed.title ?? "")),
    videos,
  };
  playlistFeedCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

function collectPlaylistVideos(data: any, out: PlaylistVideo[], seen: Set<string>) {
  for (const renderer of deepCollect(data, "playlistVideoRenderer")) {
    const videoId = renderer?.videoId;
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);
    const bylineRun = renderer?.shortBylineText?.runs?.[0] ?? renderer?.longBylineText?.runs?.[0];
    const rawIndex = renderer?.index?.simpleText ?? String(out.length + 1);
    out.push({
      videoId,
      title: decodeHtmlEntities(renderer?.title?.runs?.[0]?.text ?? renderer?.title?.simpleText ?? ""),
      thumbnail: renderer?.thumbnail?.thumbnails?.at(-1)?.url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      channelTitle: decodeHtmlEntities(bylineRun?.text ?? ""),
      channelId: bylineRun?.navigationEndpoint?.browseEndpoint?.browseId ?? "",
      duration: renderer?.lengthText?.simpleText ?? "",
      index: Number.parseInt(String(rawIndex).replace(/\D/g, ""), 10) || out.length,
    });
  }
  // Current playlist markup. YouTube migrated the first page (normally 100
  // entries) from playlistVideoRenderer to lockupViewModel.
  for (const vm of deepCollect(data, "lockupViewModel")) {
    const video = playlistVideoFromLockup(vm, out.length + 1);
    if (!video || seen.has(video.videoId)) continue;
    seen.add(video.videoId);
    out.push(video);
  }
}

export function playlistVideoFromLockup(vm: any, fallbackIndex: number): PlaylistVideo | null {
  if (!vm?.contentId || vm?.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") return null;
  const metadata = vm?.metadata?.lockupMetadataViewModel;
  const rows = metadata?.metadata?.contentMetadataViewModel?.metadataRows ?? [];
  const channelText = rows?.[0]?.metadataParts?.[0]?.text;
  const channelCommand = channelText?.commandRuns?.[0]?.onTap?.innertubeCommand;
  const imageChannelCommand = metadata?.image?.decoratedAvatarViewModel?.rendererContext?.commandContext?.onTap?.innertubeCommand;
  const watchEndpoint = vm?.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint;
  const badges = deepCollect(vm?.contentImage, "thumbnailBadgeViewModel")
    .map((badge: any) => String(badge?.text ?? ""));
  const duration = badges.find((text: string) => /^\d+(?::\d+)+$/.test(text)) ?? "";
  const sourceGroups = deepCollect(vm?.contentImage, "sources");
  const thumbnailSources = sourceGroups.find((sources: any) => Array.isArray(sources) && sources.some((source) => source?.url)) ?? [];
  return {
    videoId: vm.contentId,
    title: decodeHtmlEntities(metadata?.title?.content ?? ""),
    thumbnail: thumbnailSources.at(-1)?.url ?? `https://i.ytimg.com/vi/${vm.contentId}/hqdefault.jpg`,
    channelTitle: decodeHtmlEntities(channelText?.content ?? ""),
    channelId: channelCommand?.browseEndpoint?.browseId ?? imageChannelCommand?.browseEndpoint?.browseId ?? "",
    duration,
    index: Number.isFinite(watchEndpoint?.index) ? Number(watchEndpoint.index) + 1 : fallbackIndex,
  };
}

export async function fetchPlaylistSnapshot(playlistId: string, force = false, userId?: number): Promise<{ videos: PlaylistVideo[]; complete: boolean }> {
  const language = resolveYouTubeLanguage(userId);
  const cacheKey = `${language.cacheKey}:${playlistId}`;
  const cached = playlistVideosCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.at < ABOUT_TTL) return { videos: cached.videos, complete: cached.complete };

  const res = await fetch(`https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`, { headers: youtubeRequestHeaders(userId, language) });
  const html = await readYouTubeResponse(res, "playlist page fetch failed");
  const data = extractInitialData(html);
  const videos: PlaylistVideo[] = [];
  const seen = new Set<string>();
  collectPlaylistVideos(data, videos, seen);
  const config = innertubePlaylistConfig(html);
  let token = playlistContinuationToken(data);
  let complete = true;
  for (let page = 0; config && token && page < MAX_PLAYLIST_CONTINUATION_PAGES; page++) {
    const previousToken = token;
    try {
      const continuation = await fetchPlaylistContinuation(token, config, language);
      collectPlaylistVideos(continuation, videos, seen);
      token = playlistContinuationToken(continuation);
      if (token === previousToken) { complete = false; break; }
    } catch (error) {
      if (isYouTubeRateLimitError(error)) throw error;
      complete = false;
      break;
    }
  }
  if (token) complete = false;

  if (videos.length === 0) {
    const feed = await fetchPlaylistFeed(playlistId, force, userId);
    const fallback = feed.videos.map((video, index) => ({
      videoId: video.videoId,
      title: video.title,
      thumbnail: video.thumbnail,
      channelTitle: video.channelTitle || feed.channelTitle,
      channelId: video.channelId || feed.channelId,
      duration: "",
      index,
    }));
    playlistVideosCache.set(cacheKey, { at: Date.now(), videos: fallback, complete: false });
    return { videos: fallback, complete: false };
  }
  playlistVideosCache.set(cacheKey, { at: Date.now(), videos, complete });
  return { videos, complete };
}

/** Complete playlist videos shaped for the watch page and playlist library. */
export async function fetchPlaylistVideos(playlistId: string, userId?: number): Promise<PlaylistVideo[]> {
  return (await fetchPlaylistSnapshot(playlistId, false, userId)).videos;
}

export interface ScrapedVideo {
  videoId: string;
  title: string;
  thumbnail: string;
  duration: string;
  viewCount: number | null;
  publishedAt: string | null;
  publishedAtApproximate: boolean;
  membersOnly: boolean;
  isStream?: boolean;
  isLive?: boolean;
}

export function hasMembersOnlyBadge(node: any): boolean {
  return deepCollect(node, "badgeViewModel").some((badge: any) =>
    badge?.badgeStyle === "BADGE_MEMBERS_ONLY" || badge?.iconName === "SPONSORSHIP_STAR"
  ) || deepCollect(node, "metadataBadgeRenderer").some((badge: any) =>
    badge?.style === "BADGE_STYLE_TYPE_MEMBERS_ONLY"
  );
}

export function hasLiveBadge(node: any): boolean {
  return deepCollect(node, "thumbnailBadgeViewModel").some((badge: any) =>
    badge?.badgeStyle === "THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE"
    || badge?.icon?.sources?.some((source: any) => source?.clientResource?.imageName === "LIVE")
    || badge?.text === "LIVE"
  ) || deepCollect(node, "metadataBadgeRenderer").some((badge: any) =>
    badge?.style === "BADGE_STYLE_TYPE_LIVE_NOW"
  ) || deepCollect(node, "thumbnailOverlayTimeStatusRenderer").some((badge: any) =>
    badge?.style === "LIVE"
  );
}

function relativePublishedFromNode(node: any): string | null {
  for (const parts of deepCollect(node, "metadataParts")) {
    for (const part of Array.isArray(parts) ? parts : []) {
      for (const text of textFromMetadataPart(part)) {
        const parsed = parsePublishedTimeText(text);
        if (parsed) return relativePublishedAt(parsed);
      }
    }
  }
  const legacy = node?.publishedTimeText?.simpleText
    ?? node?.publishedTimeText?.runs?.map((part: any) => part.text).join("");
  const parsed = parsePublishedTimeText(legacy);
  return parsed ? relativePublishedAt(parsed) : null;
}

/** Scrape a channel tab for uploads or completed livestreams. */
async function fetchChannelTabVideos(channelId: string, tab: "videos" | "streams", userId?: number): Promise<ScrapedVideo[]> {
  const res = await fetch(`https://www.youtube.com/channel/${channelId}/${tab}`, { headers: youtubeRequestHeaders(userId) });
  const data = extractInitialData(await readYouTubeResponse(res, `channel ${tab} request failed`));
  const out: ScrapedVideo[] = [];
  const seen = new Set<string>();
  for (const r of deepCollect(data, "videoRenderer")) {
    if (!r?.videoId || seen.has(r.videoId)) continue;
    seen.add(r.videoId);
    const viewStr =
      r?.viewCountText?.simpleText ?? r?.viewCountText?.runs?.[0]?.text ?? "";
    // "12K views" and "12 k vues" are both twelve thousand; stripping every
    // non-digit made them both twelve.
    const viewNum = parseCompactCount(viewStr, libraryLanguage()) ?? NaN;
    out.push({
      videoId: r.videoId,
      title: decodeHtmlEntities(r.title?.runs?.[0]?.text ?? r.title?.simpleText ?? ""),
      thumbnail:
        r.thumbnail?.thumbnails?.at(-1)?.url ??
        `https://i.ytimg.com/vi/${r.videoId}/hqdefault.jpg`,
      duration: r.lengthText?.simpleText ?? "",
      viewCount: viewStr ? parseAbbreviatedCount(viewStr) : null,
      publishedAt: relativePublishedFromNode(r),
      publishedAtApproximate: true,
      membersOnly: hasMembersOnlyBadge(r),
      isLive: hasLiveBadge(r),
    });
  }

  // Current YouTube channel pages use richItemRenderer / lockupViewModel
  // cards instead of videoRenderer. This is notably used by /streams, so
  // without it completed streams are silently skipped.
  for (const vm of deepCollect(data, "lockupViewModel")) {
    const videoId = deepCollect(vm, "watchEndpoint")[0]?.videoId;
    if (!videoId || seen.has(videoId)) continue;
    const title = vm?.metadata?.lockupMetadataViewModel?.title?.content;
    if (!title) continue;
    seen.add(videoId);
    const badges = deepCollect(vm, "thumbnailBadgeViewModel")
      .map((badge: any) => badge?.text)
      .filter((text: any): text is string => typeof text === "string");
    out.push({
      videoId,
      title: decodeHtmlEntities(title),
      thumbnail:
        vm?.contentImage?.thumbnailViewModel?.image?.sources?.at(-1)?.url ??
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      duration: badges.find((text) => /^\d{1,2}:\d{2}(?::\d{2})?$/.test(text)) ?? "",
      viewCount: null,
      publishedAt: relativePublishedFromNode(vm),
      publishedAtApproximate: true,
      membersOnly: hasMembersOnlyBadge(vm),
      isLive: hasLiveBadge(vm),
    });
  }
  return out;
}

/** Scrape the channel's ordinary uploads tab. */
export async function fetchChannelVideos(channelId: string, userId?: number): Promise<ScrapedVideo[]> {
  return fetchChannelTabVideos(channelId, "videos", userId);
}

/** Scrape the channel's current and archived livestreams tab. */
export async function fetchChannelStreams(channelId: string, userId?: number): Promise<ScrapedVideo[]> {
  return (await fetchChannelTabVideos(channelId, "streams", userId)).map((video) => ({ ...video, isStream: true }));
}

export interface SearchResult {
  videoId: string;
  title: string;
  thumbnail: string;
  duration: string;
  channelId: string | null;
  channelTitle: string;
  channelAvatar: string | null;
  viewCount: number | null;
  published: PublishedAgo | null;
  /**
   * The instant, for a provider that knows it.
   *
   * YouTube never says more than "2 years ago", so `published` is a phrase and
   * a card rebuilds a date from it. Dailymotion answers with the day.
   * Coarsening that to match would throw away what we were given and walk back
   * into "il y a 0 an": two calendar years are 1.998 of the average year a
   * phrase is measured in, and the floor of that is one.
   */
  publishedAt?: string | null;
}

export interface ChannelSearchResult {
  channelId: string;
  title: string;
  thumbnail: string;
  handle: string;
  subscriberCount: string;
  videoCount: string;
}

/**
 * How long past its scheduled start a stream is still credibly upcoming.
 *
 * Streams start late, and a premiere pushed by a day is ordinary. A week is
 * not: nothing that was going to happen is still going to happen a week after
 * it was announced for.
 */
const ABANDONED_SCHEDULE_MS = 7 * 24 * 60 * 60_000;

/**
 * A scheduled stream that was never going to happen.
 *
 * YouTube keeps answering "upcoming" for these forever — measured on a stream
 * scheduled for July 2016 and still reported as upcoming ten years later. Taken
 * at face value it sits on the Live page for good, because nothing about it
 * will ever change again: it never starts, so it never ends.
 *
 * Read with its date, the same answer settles itself. It stops being upcoming
 * and falls through to what it plainly is — live content that is not live.
 */
export function isAbandonedSchedule(
  scheduledStartTime: string | number | null | undefined,
  now: () => number = Date.now,
): boolean {
  const seconds = Number(scheduledStartTime);
  if (!Number.isFinite(seconds) || seconds <= 0) return false;
  return now() - seconds * 1000 > ABANDONED_SCHEDULE_MS;
}

export interface PublishedAgo {
  value: number;
  unit: "second" | "minute" | "hour" | "day" | "week" | "month" | "year";
}

/**
 * YouTube only exposes a relative label here ("3 days ago", "il y a 2 semaines",
 * "Streamed 2 weeks ago").
 *
 * It used to be read by regexes kept here, which is why the request had to be
 * pinned to English: the label arrives in whatever language the page was asked
 * for, and these knew three of the four the app speaks. The grammars now live
 * in one table beside the panel's, and this reads the label without being told
 * which language wrote it — a page can be fetched in any of them.
 */
export function parsePublishedTimeText(text: string | undefined): PublishedAgo | null {
  return parsePublishedTextAnyLanguage(text);
}

export function relativePublishedAt(published: PublishedAgo, now = new Date()): string {
  const date = new Date(now);
  const value = Math.max(0, published.value);
  if (published.unit === "year") date.setUTCFullYear(date.getUTCFullYear() - value);
  else if (published.unit === "month") date.setUTCMonth(date.getUTCMonth() - value);
  else {
    const seconds = value * ({ second: 1, minute: 60, hour: 3600, day: 86400, week: 604800 } as const)[published.unit];
    date.setTime(date.getTime() - seconds * 1000);
  }
  return date.toISOString();
}

export const {
  collectSearchVideos,
  fetchSearchSuggestions,
  searchChannelFromLockup,
  searchDeeper,
  searchVideoFromLockup,
  searchYouTube,
} = createYoutubeSearch({
  requestHeaders: youtubeRequestHeaders,
  resolveCacheKey: (userId) => resolveYouTubeLanguage(userId).cacheKey,
  // A search walk is one reader's, so its pages are asked for in one language
  // from beginning to end — the jar's own preference rewritten to match, since
  // that preference outranks both the header and the `hl` in the body.
  fetchHeaders: (language?: PanelLanguage) => {
    const base = youtubeRequestHeaders();
    return { ...base, ...languageHeaders(base.Cookie, language ?? libraryLanguage()) };
  },
  countLanguage: libraryLanguage,
  cleanSubscriberCount,
  deepCollect,
  extractInitialData,
  isSubscriberText,
  isVideoCountText,
  isViewCountText,
  parsePublishedTimeText,
});

export interface VideoInfo {
  videoId: string;
  /** What a reader here should see: the translated title when there is one. */
  title: string;
  /** What the uploader wrote, kept so a rename can be told from a translation. */
  titleOriginal?: string;
  channelId: string;
  channelTitle: string;
  description: string;
  thumbnail: string;
  viewCount: number | null;
  publishedAt: string | null;
  duration: string | null;
  liveStatus: "none" | "live" | "upcoming" | "was_live";
  /**
   * Whether the uploader allows playback outside youtube.com.
   *
   * null when the answer did not carry it — the InnerTube and embed fallbacks
   * do not — so an unknown is never mistaken for a refusal.
   */
  playableInEmbed: boolean | null;
}

export interface VideoCreatorInfo {
  channelId: string;
  title: string;
  avatar: string;
  handle: string;
  isOwner: boolean;
}

/** Parse YouTube's native multi-creator attribution dialog. This deliberately
 * ignores @mentions in descriptions: only channels explicitly attached by
 * YouTube count as collaborators. */
export function parseVideoCreatorsFromInitialData(data: any, ownerChannelId: string): VideoCreatorInfo[] {
  // `attributedTitle` and the dialog command are siblings in some watch-page
  // payloads and nested in others. Scan dialogs directly instead of depending
  // on that unstable wrapper shape.
  const dialogs = [
    ...deepCollect(data, "dialogViewModel"),
    ...deepCollect(data, "showDialogViewModel"),
  ];
  for (const dialog of dialogs) {
    const items = dialog?.customContent?.listViewModel?.listItems;
    if (!Array.isArray(items) || items.length < 2) continue;

    const creators: VideoCreatorInfo[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const model = item?.listItemViewModel;
      const title = model?.title?.content;
      const channelId = deepCollect(model?.title, "browseEndpoint")[0]?.browseId
        ?? deepCollect(model?.leadingAccessory, "browseEndpoint")[0]?.browseId;
      if (typeof channelId !== "string" || !channelId.startsWith("UC") || seen.has(channelId) || typeof title !== "string" || !title) continue;
      seen.add(channelId);
      const sources = deepCollect(model?.leadingAccessory, "sources")
        .flat()
        .filter((source: any) => typeof source?.url === "string");
      const subtitle = typeof model?.subtitle?.content === "string" ? model.subtitle.content : "";
      const handleMatch = subtitle.match(/@([\p{L}\p{N}._-]+)/u);
      creators.push({
        channelId,
        title: decodeHtmlEntities(title),
        avatar: sources.at(-1)?.url ?? "",
        handle: handleMatch ? `@${handleMatch[1]}` : "",
        isOwner: channelId === ownerChannelId,
      });
    }
    if (creators.length > 1 && (!ownerChannelId || creators.some((creator) => creator.isOwner))) {
      if (!ownerChannelId) creators[0].isOwner = true;
      return creators;
    }
  }
  return [];
}

export function parseVideoCreatorsFromHtml(html: string): VideoCreatorInfo[] {
  const player = extractVariable(html, "ytInitialPlayerResponse");
  const ownerChannelId = player?.videoDetails?.channelId
    ?? player?.microformat?.playerMicroformatRenderer?.externalChannelId
    ?? "";
  return parseVideoCreatorsFromInitialData(extractInitialData(html), ownerChannelId);
}

export async function fetchVideoCreators(videoId: string, userId?: number): Promise<VideoCreatorInfo[]> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { headers: youtubeRequestHeaders(userId) });
  if (!res.ok) throw new Error(`YouTube creators fetch failed (${res.status})`);
  return parseVideoCreatorsFromHtml(await res.text());
}

const videoInfoCache = new Map<string, { at: number; data: VideoInfo }>();
const VIDEO_INFO_TTL = 10 * 60_000;

/**
 * The title YouTube shows a reader in the language it was asked in.
 *
 * The player response carries what the uploader wrote and nothing else, so a
 * Japanese video is a Japanese title there even when YouTube is showing every
 * French viewer a French one. The translated title is on the page beside it,
 * in the block the watch page draws its heading from — which is the title this
 * library should keep, since it is the one the reader would have seen had they
 * opened the video on YouTube.
 *
 * Nothing is invented: no translation, no answer.
 */
export function localisedTitleFromInitialData(initialData: any): string | null {
  const contents = initialData?.contents?.twoColumnWatchNextResults?.results?.results?.contents;
  if (!Array.isArray(contents)) return null;
  for (const item of contents) {
    const runs = item?.videoPrimaryInfoRenderer?.title?.runs;
    if (!Array.isArray(runs)) continue;
    const title = runs.map((run: any) => (typeof run?.text === "string" ? run.text : "")).join("").trim();
    if (title) return title;
  }
  return null;
}

export function videoInfoFromPlayerResponse(videoId: string, pr: any): VideoInfo {
  const vd = pr?.videoDetails;
  if (!vd?.videoId) {
    // Surface why YouTube withheld the video: a stripped player response with
    // playabilityStatus LOGIN_REQUIRED + "confirm you're not a bot" means the
    // server's egress IP is bot-flagged (VPN/WARP/datacenter), not a bug here.
    const ps = pr?.playabilityStatus;
    const renderer = ps?.errorScreen?.playerErrorMessageRenderer;
    const reason = ps?.reason
      ?? renderer?.reason?.simpleText
      ?? renderer?.reason?.runs?.map((part: any) => part?.text ?? "").join("")
      ?? renderer?.subreason?.simpleText
      ?? renderer?.subreason?.runs?.map((part: any) => part?.text ?? "").join("");
    const detail = pr == null
      ? "no player response"
      : [ps?.status, reason].filter(Boolean).join(": ") || "no playabilityStatus";
    if (/\bprivate video\b/i.test(detail)) throw new PrivateVideoError(detail);
    if (isDeletedVideoError(new Error(detail))) throw new DeletedVideoError(detail);
    throw new Error(`videoDetails missing (${detail})`);
  }

  const mf = pr?.microformat?.playerMicroformatRenderer;
  const lengthSec = parseInt(vd.lengthSeconds ?? "", 10);
  const duration = Number.isFinite(lengthSec) && lengthSec > 0
    ? `${Math.floor(lengthSec / 60)}:${String(lengthSec % 60).padStart(2, "0")}`
    : null;
  const scheduledStart = pr?.playabilityStatus?.liveStreamability?.liveStreamabilityRenderer
    ?.offlineSlate?.liveStreamOfflineSlateRenderer?.scheduledStartTime;
  const liveStatus: VideoInfo["liveStatus"] = vd.isLive === true
    ? "live"
    : (scheduledStart || pr?.playabilityStatus?.status === "LIVE_STREAM_OFFLINE") && !isAbandonedSchedule(scheduledStart)
      ? "upcoming"
      : vd.isLiveContent === true
        ? "was_live"
        : "none";

  return {
    videoId: vd.videoId,
    title: decodeHtmlEntities(vd.title ?? ""),
    titleOriginal: decodeHtmlEntities(vd.title ?? ""),
    channelId: vd.channelId ?? mf?.externalChannelId ?? "",
    channelTitle: decodeHtmlEntities(vd.author ?? mf?.ownerChannelName ?? ""),
    description: vd.shortDescription ?? "",
    thumbnail: vd.thumbnail?.thumbnails?.at(-1)?.url
      ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    viewCount: parseInt(vd.viewCount ?? "", 10) || null,
    publishedAt: mf?.publishDate ?? null,
    duration,
    liveStatus,
    // Only the watch page carries it; the InnerTube and embed fallbacks do
    // not, and there an unknown must stay unknown.
    playableInEmbed: typeof pr?.playabilityStatus?.playableInEmbed === "boolean"
      ? pr.playabilityStatus.playableInEmbed
      : typeof vd?.playableInEmbed === "boolean" ? vd.playableInEmbed : null,
  };
}

async function fetchVideoInfoFromInnerTube(videoId: string): Promise<VideoInfo> {
  const data = await _yt.player({ videoId });
  return videoInfoFromPlayerResponse(videoId, data);
}

async function fetchVideoInfoFromEmbed(videoId: string, userId?: number): Promise<VideoInfo> {
  const res = await fetch(`https://www.youtube.com/embed/${videoId}`, { headers: youtubeRequestHeaders(userId) });
  if (!res.ok) throw new Error(`YouTube embed fetch failed (${res.status})`);
  const pr = extractVariable(await res.text(), "ytInitialPlayerResponse");
  return videoInfoFromPlayerResponse(videoId, pr);
}

/**
 * The several ways a YouTube page says it knows who is reading it.
 *
 * One marker was not enough: it appears on a watch page and not on the home
 * page, so a check made against the home page reported "not recognised" for a
 * jar that was working perfectly a second later — a false alarm is worse than
 * no alarm, since it sends somebody to re-export cookies that were fine.
 */
function readsAsSignedIn(html: string): boolean {
  return /"LOGGED_IN"\s*:\s*true/.test(html)
    || /"logged_in"\s*:\s*(?:true|"1")/.test(html)
    || /"isSignedIn"\s*:\s*true/.test(html);
}

/**
 * Whether YouTube still knows the account behind a jar.
 *
 * Asked directly rather than inferred from whatever else happened to make a
 * signed-in request: the panel is fetched anonymously by default, so waiting
 * for it to report would leave the question unanswered for ever on most
 * instances. The home page is the cheapest thing that carries the marker.
 */
export async function fetchYoutubeSessionState(
  cookieHeader: string,
  userId?: number,
): Promise<{ signedIn: boolean; setCookies: string[] }> {
  const language = resolveYouTubeLanguage(userId);
  const base = youtubeRequestHeaders(userId, language);
  const res = await fetch("https://www.youtube.com/", {
    headers: { ...base, ...languageHeaders(`${base.Cookie}; ${cookieHeader}`, language.hl as PanelLanguage) },
  });
  if (!res.ok) throw new Error(`YouTube fetch failed (${res.status})`);
  const html = await res.text();
  return { signedIn: readsAsSignedIn(html), setCookies: res.headers.getSetCookie?.() ?? [] };
}

/**
 * Read the side panel as somebody, when asking as nobody was refused.
 *
 * The panel only ever comes from the watch page, and the watch page is the one
 * thing yt-dlp cannot stand in for: its answer describes the video, not what
 * YouTube would put beside it. So the fallback that rescues an import cannot
 * rescue the panel, and on a refused address every video ends up with the
 * library's own list — which is how a suggestion panel comes to show nothing
 * but the channel you are already watching.
 *
 * A signed-in request is refused far less often than an anonymous one, and the
 * jar is already on disk for yt-dlp. This asks the same page with it, once,
 * for the video somebody is looking at.
 */
export async function fetchRelatedVideosAsSomebody(
  videoId: string,
  cookieHeader: string,
  language: PanelLanguage = "en",
  /**
   * Told what the answer said about the session: whether the account behind
   * the jar was recognised, and which cookies the response rotated.
   */
  session?: { signedIn: boolean; setCookies: string[] },
): Promise<RelatedVideo[]> {
  const base = youtubeRequestHeaders();
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { ...base, ...languageHeaders(`${base.Cookie}; ${cookieHeader}`, language) },
  });
  if (!res.ok) throw new Error(`YouTube fetch failed (${res.status})`);
  const html = await res.text();
  // Sending a jar is not the same as being known for it. An expired or rotated
  // jar is answered with the page a stranger gets — parseable, twenty
  // suggestions, and about nobody. Saying "credentialed" for the attempt made
  // rather than the answer received is how a dead jar can look like a working
  // one for a morning.
  if (session) {
    session.signedIn = readsAsSignedIn(html);
    // YouTube rotates cookies as it answers. A browser writes them down; a
    // file exported once does not, and drifts behind until it is no longer
    // recognised at all.
    session.setCookies = res.headers.getSetCookie?.() ?? [];
  }
  return relatedVideosFromWatchPage(extractVariable(html, "ytInitialData"), 40, language);
}

/**
 * Read a video's details.
 *
 * `related` is an out-parameter rather than part of the answer: the watch page
 * is downloaded here anyway, and the panel of suggestions beside the video is
 * in it. Whoever wants that list gets it for the price of parsing, and
 * everybody else is unaffected. It stays empty when the page was not the
 * source — the InnerTube and embed fallbacks carry no such panel.
 */
export async function fetchVideoInfo(
  videoId: string,
  options: { force?: boolean; userId?: number; related?: { videos: RelatedVideo[] }; language?: PanelLanguage } = {},
): Promise<VideoInfo> {
  const cacheKey = `${resolveYouTubeLanguage(options.userId).cacheKey}:${videoId}`;
  if (options.force) videoInfoCache.delete(cacheKey);
  const cached = videoInfoCache.get(cacheKey);
  if (cached && Date.now() - cached.at < VIDEO_INFO_TTL) return cached.data;
  // Three attempts that are all going to be refused cost seconds, and they are
  // spent in front of someone opening a video. One refusal speaks for the rest.
  if (videoInfoRefusalQuiet.quiet()) throw new YouTubeRefusingError();

  youtubeRefusalGate.enter();

  let result: VideoInfo;
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const res = await fetch(url, { headers: youtubeRequestHeaders(options.userId) });
    if (!res.ok) throw new Error(`YouTube fetch failed (${res.status})`);
    const html = await res.text();
    if (options.related) {
      options.related.videos = relatedVideosFromWatchPage(extractVariable(html, "ytInitialData"), 40, options.language ?? "en");
    }
    const pr = extractVariable(html, "ytInitialPlayerResponse");
    result = videoInfoFromPlayerResponse(videoId, pr);
    // Asked for in a language, so answered in it. The uploader's own title is
    // kept beside it rather than replaced — see `title_original`.
    const localised = localisedTitleFromInitialData(extractVariable(html, "ytInitialData"));
    if (localised) result = { ...result, title: localised };
  } catch (htmlError) {
    if (isYouTubeRefusalError(htmlError)) throw youtubeRefusalGate.refused(htmlError);
    try {
      result = await fetchVideoInfoFromInnerTube(videoId);
    } catch (innerTubeError) {
      if (isYouTubeRefusalError(innerTubeError)) throw youtubeRefusalGate.refused(innerTubeError);
      try {
        result = await fetchVideoInfoFromEmbed(videoId, options.userId);
      } catch (embedError) {
        // In the order they were asked, rather than one verdict outranking the
        // other whoever gave it. The watch page sees the most and answers
        // first; letting the embed's "private" beat its "unavailable" is how a
        // deleted video came to be filed as private.
        for (const attempt of [htmlError, innerTubeError, embedError]) {
          if (isPrivateVideoError(attempt)) throw new PrivateVideoError();
          if (isDeletedVideoError(attempt)) throw new DeletedVideoError();
        }
        youtubeRefusalGate.releaseProbe();
        const primary = htmlError instanceof Error ? htmlError.message : String(htmlError);
        const fallback = innerTubeError instanceof Error ? innerTubeError.message : String(innerTubeError);
        const embed = embedError instanceof Error ? embedError.message : String(embedError);
        const failure = new Error(`video info failed: html=${primary}; innertube=${fallback}; embed=${embed}`);
        videoInfoRefusalQuiet.note(failure);
        throw failure;
      }
    }
  }
  videoInfoRefusalQuiet.clear();
  videoInfoCache.set(cacheKey, { at: Date.now(), data: result });
  youtubeRefusalGate.answered();
  return result;
}

/** Fetch only the exact publish date without requiring a playable video. */
export async function fetchVideoPublishedAt(videoId: string, userId?: number): Promise<string | null> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { headers: youtubeRequestHeaders(userId) });
  let html: string;
  try {
    html = await readYouTubeResponse(res, "YouTube publication date fetch failed");
  } catch (error) {
    if (isYouTubeRateLimitError(error)) throw error;
    return null;
  }
  const playerDate = extractVariable(html, "ytInitialPlayerResponse")
    ?.microformat?.playerMicroformatRenderer?.publishDate;
  const raw = typeof playerDate === "string" ? playerDate
    : html.match(/"publishDate":"([^"]+)"/)?.[1]
      ?? html.match(/"uploadDate":"([^"]+)"/)?.[1]
      ?? html.match(/itemprop="datePublished" content="([^"]+)"/)?.[1];
  if (!raw || !/^\d{4}-\d{2}-\d{2}/.test(raw)) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export interface VideoChapter {
  title: string;
  /** Start offset in whole seconds. */
  start: number;
}

const chaptersCache = new Map<string, { at: number; data: VideoChapter[] }>();
const CHAPTERS_TTL = 60 * 60_000;

/**
 * Scrape a video's chapter list from the watch page (same source as durations).
 * Chapters live in `ytInitialData` under `chapterRenderer` — YouTube derives
 * them from description timestamps or creator-defined markers. Returns an empty
 * list when the video has no chapters. No YouTube API involved.
 */
export async function fetchVideoChapters(videoId: string, userId?: number): Promise<VideoChapter[]> {
  const cacheKey = `${resolveYouTubeLanguage(userId).cacheKey}:${videoId}`;
  const cached = chaptersCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CHAPTERS_TTL) return cached.data;

  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { headers: youtubeRequestHeaders(userId) });
  if (!res.ok) return [];
  const data = extractInitialData(await res.text());
  const out: VideoChapter[] = [];
  const seen = new Set<number>();
  for (const ch of deepCollect(data, "chapterRenderer")) {
    const title = ch?.title?.simpleText;
    const start = Math.floor(Number(ch?.timeRangeStartMillis) / 1000);
    if (typeof title !== "string" || !title || !Number.isFinite(start) || seen.has(start)) continue;
    seen.add(start);
    out.push({ title, start });
  }
  out.sort((a, b) => a.start - b.start);
  chaptersCache.set(cacheKey, { at: Date.now(), data: out });
  return out;
}

/**
 * Detect whether a video is a YouTube Short. /shorts/<id> responds 200 for
 * Shorts and redirects (303) to /watch for regular videos.
 *
 * This was the one thing still talking to YouTube while YouTube was refusing
 * the address. Its own endpoint kept answering, so nothing stopped it — but a
 * single channel sync can queue a hundred and seventy of these in a quarter of
 * an hour, each one a request from an address already being rate-limited, and
 * the sync that followed came back `rateLimited: true`.
 *
 * Nothing here is urgent: an unclassified video is asked about again later,
 * with its own backoff. Waiting for the refusal to lift costs a delay; not
 * waiting costs the refusal.
 */
export async function classifyIsShort(
  videoId: string,
  title: string,
  fetchImpl: typeof fetch = fetch,
  duration?: string | null,
): Promise<boolean | null> {
  if (/#shorts?\b/i.test(title)) return true;
  if (videoInfoRefusalQuiet.quiet()) return null;
  try {
    const res = await fetchImpl(`https://www.youtube.com/shorts/${videoId}`, {
      method: "HEAD",
      redirect: "manual",
      headers: youtubeRequestHeaders(),
    });
    if (res.status === 429) throw youtubeRefusalGate.refused(new Error("YouTube shorts fetch failed (429)"));
    if (res.status === 200) {
      const availability = await fetchVideoOEmbedAvailability(videoId, fetchImpl);
      youtubeRefusalGate.answered();
      return availability === "available" ? true : null;
    }
    const location = res.headers.get("location") ?? "";
    if (res.status >= 300 && res.status < 400 && /\/watch(?:\?|$)/i.test(location)) {
      youtubeRefusalGate.answered();
      return false;
    }
    youtubeRefusalGate.answered();
    return null;
  } catch (error) {
    if (error instanceof Error && error.name === "YouTubeRefusalError") throw error;
    youtubeRefusalGate.releaseProbe();
    return null;
  }
}

/** Parse an OPML export (e.g. from NewPipe/FreeTube) into channel IDs. */
export function parseOpml(content: string): { channelId: string; title: string }[] {
  const doc = xml.parse(content);
  const result: { channelId: string; title: string }[] = [];
  const walk = (node: any) => {
    for (const outline of asArray<any>(node?.outline)) {
      const xmlUrl: string = outline["@_xmlUrl"] ?? "";
      const m = xmlUrl.match(/channel_id=(UC[\w-]{22})/);
      if (m) result.push({ channelId: m[1], title: decodeHtmlEntities(outline["@_title"] ?? outline["@_text"] ?? "") });
      walk(outline);
    }
  };
  walk(doc?.opml?.body ?? {});
  return result;
}

/** Parse a Google Takeout subscriptions.csv (Channel Id, Channel Url, Channel Title). */
export function parseTakeoutCsv(content: string): { channelId: string; title: string }[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  const result: { channelId: string; title: string }[] = [];
  for (const line of lines) {
    const m = line.match(/(UC[\w-]{22})/);
    if (!m) continue;
    // Title is the last CSV column; tolerate commas elsewhere.
    const cols = line.split(",");
    result.push({ channelId: m[1], title: decodeHtmlEntities(cols.length >= 3 ? cols.slice(2).join(",").trim() : "") });
  }
  return result;
}
