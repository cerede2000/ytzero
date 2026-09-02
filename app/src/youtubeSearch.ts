import { decodeHtmlEntities } from "./htmlEntities";
import { log } from "./logger";
import { readYouTubeResponse } from "./youtubeRateLimit";
import { sapisidFrom, sapisidHash } from "./youtubeInnerTube";
import { languageHeaders } from "./youtubeLanguageCookie";
import type { ChannelSearchResult, PublishedAgo, SearchResult } from "./youtube";
import { readCount } from "./countText";
import { parseCompactCount, type PanelLanguage } from "./relatedVideoText";

interface YoutubeSearchDependencies {
  requestHeaders: (userId?: number) => Record<string, string>;
  resolveCacheKey: (userId?: number) => string;
  fetchHeaders: (language?: PanelLanguage) => Record<string, string>;
  /** Which language these pages were asked for, so their counts can be read. */
  countLanguage: () => PanelLanguage;
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
export function walkKey(query: string, reader: number | null, language: PanelLanguage = "en"): string {
  return `${reader ?? "personne"}\u0000${language}\u0000${query}`;
}

/**
 * The client a continuation is asked as.
 *
 * `hl` is the language of the answer, not a preference: YouTube hands back the
 * title in the language asked for, and a video that carries a translated title
 * has two. Asked in English, a French video comes back as its English title —
 * on page two of a search only, because the first page is an HTML page that
 * answers to Accept-Language instead. The two must name the same language or
 * the same video is called two different things as the reader scrolls.
 *
 * `gl` stays where it is: it ranks results by region rather than translating
 * them, and moving it would quietly reorder every search.
 */
export function searchClient(clientVersion: string, language: PanelLanguage) {
  return { clientName: "WEB", clientVersion, hl: language, gl: "US" };
}

export function createYoutubeSearch(dependencies: YoutubeSearchDependencies) {
  const {
    requestHeaders,
    resolveCacheKey,
    fetchHeaders,
    countLanguage,
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

async function fetchSearchData(query: string, filter = "", language: PanelLanguage = "en"): Promise<any | null> {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}${filter}`;
  const res = await fetch(url, { headers: fetchHeaders(language) });
  if (!res.ok) throw new Error(`YouTube search failed (${res.status})`);
  return extractInitialData(await res.text());
}

// YouTube's "Channel" search filter (sp=EgIQAg%3D%3D). The default results page
// increasingly leads with video cards and omits the channel entirely, so we
// re-query with this filter when no channel surfaced.
const SEARCH_CHANNEL_FILTER = "&sp=EgIQAg%3D%3D";

/**
 * How many continuations one window may cost.
 *
 * Not a budget so much as a stop: the loop below already ends the moment it
 * has one result past the window, so a query whose pages are full pays two
 * steps and no more. It is the later windows that need the room. Each
 * continuation repeats some of what came before, so the yield falls as the
 * walk goes on — measured on "musique", two steps a window gave forty, then
 * thirty-five, then twenty-one, then four, and then nothing at all, while the
 * walk itself was still moving and had a hundred and sixty-nine to give. A
 * window that comes back empty stops the scroll on a list that had not ended.
 *
 * Eight is what it takes to keep filling one that far down, and it is only
 * ever spent by somebody who has scrolled that far.
 */
const MAX_SEARCH_CONTINUATIONS = 8;

/**
 * More of the same search, by the road YouTube's own page takes.
 *
 * The results page holds about twenty and hangs the rest off a continuation
 * token, which is how scrolling gets them. Beside a provider that answers with
 * sixty, twenty reads as a broken search rather than a shallow one — so when
 * the results are to be mixed, the token is followed, the same way the channel
 * posts scraper already does.
 *
 * `searchYouTube` above is untouched and still answers the page that asks it.
 */
const SEARCH_CONTINUATION_ENDPOINT = "https://www.youtube.com/youtubei/v1/search";

/**
 * Asked as the reader, when the reader has a jar.
 *
 * Anonymous, this is a scraper, and YouTube treats it as one: the depth a
 * search reaches collapses under challenges long before its index runs out.
 * Signed in, it is a browser. The signature is the one the site's own scripts
 * compute, and it is the same machinery the suggestions panel already uses.
 *
 * The jar is the reader's own and never a borrowed one. A search ranked for an
 * account is that account's, and lending it hands one person's viewing habits
 * to whoever searches next — the rule the panel already follows.
 */
function searchHeaders(cookieHeader: string | null, language: PanelLanguage): Record<string, string> {
  if (!cookieHeader) return fetchHeaders(language);
  const sapisid = sapisidFrom(cookieHeader);
  if (!sapisid) return fetchHeaders(language);
  return {
    ...fetchHeaders(language),
    // The jar carries YouTube's own language preference, and that preference
    // outranks both the header above and the `hl` in the body. Asked with a jar
    // exported from an English browser, a French instance was answered in
    // English until this line was here.
    ...languageHeaders(cookieHeader, language),
    Authorization: sapisidHash(sapisid, "https://www.youtube.com", Date.now()),
    Origin: "https://www.youtube.com",
    "X-Origin": "https://www.youtube.com",
    "X-Goog-AuthUser": "0",
  };
}

function searchContinuationToken(data: any): string | null {
  for (const renderer of deepCollect(data, "continuationItemRenderer")) {
    const token = renderer?.continuationEndpoint?.continuationCommand?.token;
    if (typeof token === "string" && token) return token;
  }
  return null;
}

function innertubeConfig(html: string): { apiKey: string; clientVersion: string } | null {
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  const clientVersion = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)?.[1];
  return apiKey && clientVersion ? { apiKey, clientVersion } : null;
}

/**
 * One walk down a search, kept where it stopped.
 *
 * Scrolling asks for the next forty, and the token that reaches them is only
 * obtained by having followed the ones before it. Restarting the walk for
 * every page would re-fetch everything already shown and multiply the requests
 * a scraper makes by the number of times somebody scrolls. So the walk is
 * held: a second page resumes from the token the first one stopped on.
 */
interface SearchWalk {
  at: number;
  /**
   * The language every page of this walk is asked in.
   *
   * The first page is an HTML page answering to Accept-Language and the rest
   * are an API call carrying `hl`; a video whose channel publishes a
   * translated title is named by whichever was asked for. Both halves read
   * this, so one list is in one language — and the counts and dates on those
   * cards are parsed as the same language they were written in.
   */
  language: PanelLanguage;
  results: SearchResult[];
  channels: ChannelSearchResult[];
  seen: Set<string>;
  token: string | null;
  /** Consecutive continuations that brought nothing new. */
  barren: number;
  config: { apiKey: string; clientVersion: string } | null;
  /** Kept for the continuations, which must be asked by whoever began the walk. */
  cookieHeader: string | null;
  /** What the answers rotated, handed back so the session stays a live one. */
  harvest: ((setCookies: string[]) => void) | null;
}

const walks = new Map<string, SearchWalk>();

/** One walk per query; a session that searches all day must not grow without bound. */
const WALKS_MAX = 40;

async function beginWalk(
  query: string,
  cookieHeader: string | null,
  harvest: ((setCookies: string[]) => void) | null,
  language: PanelLanguage,
): Promise<SearchWalk> {
  const response = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, {
    headers: searchHeaders(cookieHeader, language),
  });
  harvest?.(response.headers.getSetCookie());
  // Named rather than guessed at: a challenge page parses as no data at all,
  // and "layout change" is the wrong thing to tell somebody who is throttled.
  const html = await readYouTubeResponse(response, "YouTube search failed");
  const data = extractInitialData(html);
  if (!data) throw new Error("YouTube search returned no data (bot challenge or layout change)");
  const config = innertubeConfig(html);
  const walk: SearchWalk = {
    at: Date.now(),
    language,
    results: [],
    // Read off the page that was fetched anyway, rather than fetching it twice.
    channels: collectSearchChannels(data).slice(0, 10),
    seen: new Set<string>(),
    token: config ? searchContinuationToken(data) : null,
    barren: 0,
    config,
    cookieHeader,
    harvest,
  };
  absorb(walk, data);
  return walk;
}

function absorb(walk: SearchWalk, page: any): void {
  for (const result of collectSearchVideos(page)) {
    if (walk.seen.has(result.videoId)) continue;
    walk.seen.add(result.videoId);
    walk.results.push(result);
  }
}

/**
 * Why a walk stopped, said out loud.
 *
 * It used to stop in silence, which left "YouTube gave up early" with no way
 * to tell a refusal from a page of Shorts from a genuinely finished list —
 * three problems with three different answers. The query is not written down:
 * what somebody searched for is theirs, and none of these lines need it.
 */
function endWalk(walk: SearchWalk, reason: string, detail: Record<string, unknown> = {}): void {
  walk.token = null;
  log.info("youtube.search_walk_ended", { reason, gathered: walk.results.length, signedIn: Boolean(walk.cookieHeader), ...detail });
}

async function stepWalk(walk: SearchWalk): Promise<boolean> {
  if (!walk.token || !walk.config) return false;
  try {
    const response = await fetch(`${SEARCH_CONTINUATION_ENDPOINT}?prettyPrint=false&key=${encodeURIComponent(walk.config.apiKey)}`, {
      method: "POST",
      headers: { ...searchHeaders(walk.cookieHeader, walk.language), "Content-Type": "application/json", Origin: "https://www.youtube.com" },
      body: JSON.stringify({
        context: { client: searchClient(walk.config.clientVersion, walk.language) },
        continuation: walk.token,
      }),
    });
    walk.harvest?.(response.headers.getSetCookie());
    if (!response.ok) {
      endWalk(walk, "refused", { status: response.status });
      return false;
    }
    const next = await response.json();
    const before = walk.results.length;
    absorb(walk, next);
    // What the page held instead, when it held nothing this reads. Their deeper
    // pages turn to Shorts, and a reader who cannot see that reads it as a bug.
    const shorts = walk.results.length > before ? 0 : deepCollect(next, "shortsLockupViewModel").length;
    /*
     * A token can keep advancing over pages that hold nothing this reads —
     * shelves, promotions, results already seen. Followed on faith, it reports
     * "there is more" for ever and every scroll asks for a window that comes
     * back empty. Two barren steps in a row is the end of the list.
     */
    walk.barren = walk.results.length > before ? 0 : walk.barren + 1;
    const following = searchContinuationToken(next);
    // A token that repeats itself is a page that has stopped moving.
    if (walk.barren >= 2) {
      endWalk(walk, shorts ? "shorts_only" : "nothing_new", { shorts });
    } else if (!following) {
      endWalk(walk, "no_continuation");
    } else if (following === walk.token) {
      endWalk(walk, "token_repeated");
    } else {
      walk.token = following;
    }
    return walk.token !== null || walk.results.length > before;
  } catch (error) {
    // Depth is a bonus. What has been gathered is still an answer — but a
    // challenge and a network blip look identical from the results alone.
    endWalk(walk, "failed", { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/**
 * As much of a search as has been asked for, and whether there is more.
 *
 * `searchYouTube` above is untouched and still answers the route that calls it.
 */
async function searchDeeper(
  query: string,
  wanted: number,
  reader: { id: number; cookieHeader: string | null; onSetCookies?: (setCookies: string[]) => void } | null = null,
  language: PanelLanguage = countLanguage(),
): Promise<{ results: SearchResult[]; channels: ChannelSearchResult[]; more: boolean }> {
  const key = walkKey(query, reader?.cookieHeader ? reader.id : null, language);
  let walk = walks.get(key);
  if (!walk || Date.now() - walk.at > SEARCH_TTL) {
    walk = await beginWalk(query, reader?.cookieHeader ?? null, reader?.onSetCookies ?? null, language);
    if (walks.size >= WALKS_MAX) walks.clear();
    walks.set(key, walk);
  }
  // One past the window, because that is the only honest evidence of more.
  for (let step = 0; walk.results.length <= wanted && walk.token && step < MAX_SEARCH_CONTINUATIONS; step++) {
    await stepWalk(walk);
  }
  /*
   * More means either results past this window or a walk that is still moving.
   * The second half is only safe because a token that has stopped producing is
   * dropped above: followed on faith it promised a next page for ever.
   */
  return { results: walk.results.slice(0, wanted), channels: walk.channels, more: walk.results.length > wanted || Boolean(walk.token) };
}

async function searchYouTube(query: string, language: PanelLanguage = countLanguage()): Promise<{ results: SearchResult[]; channels: ChannelSearchResult[] }> {
  // Keyed by language too: the same query answers different titles in each,
  // and one reader's search must not name another reader's results.
  const cacheKey = `${language}\u0000${query}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SEARCH_TTL) return cached.data;

  const data = await fetchSearchData(query, "", language);
  if (!data) throw new Error("YouTube search returned no data (bot challenge or layout change)");

  const results = collectSearchVideos(data);
  let channels = collectSearchChannels(data);

  // The default layout often drops the channel card for channel-name queries;
  // a channel-filtered follow-up reliably brings it back.
  if (channels.length === 0) {
    try {
      const channelData = await fetchSearchData(query, SEARCH_CHANNEL_FILTER, language);
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
