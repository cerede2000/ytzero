import { YTDLP } from "./downloadConfig";
import { log } from "./logger";
import { libraryLanguage } from "./libraryLanguage";

/**
 * Dailymotion, kept at arm's length.
 *
 * A deliberate island: nothing here writes to `videos`, nothing here is asked
 * for by the feed, and no YouTube path knows it exists. The point is to find
 * out whether the pipeline this application is built on — resolve with yt-dlp,
 * serve the stream ourselves, let the client choose picture or sound — holds
 * for a second source, before deciding what an identifier means or what a sync
 * would look like.
 */
const SEARCH_API = "https://api.dailymotion.com/videos";
const SEARCH_FIELDS = "id,title,duration,thumbnail_360_url,owner.screenname,created_time,views_total,status,private,allow_embed,available_formats";
/*
 * How long a resolution is reused.
 *
 * It was a minute, on the assumption that a signed URL is short-lived. Measured
 * since: one was still serving segment 1400 ten minutes after it was minted.
 * A minute meant paying 2.2 seconds of yt-dlp again on every request past it —
 * which the reporting instance's log shows plainly — for nothing. Ten minutes,
 * and an expired signature is repaired by re-signing rather than by guessing
 * short.
 */
const STREAM_TTL_MS = 10 * 60_000;
/** Dailymotion's own id grammar: an x and base-36, nothing that could be a path. */
const VIDEO_ID = /^x[a-z0-9]{5,9}$/i;
const MEDIA_HOSTS = ["dmcdn.net", "dailymotion.com"];

export interface DailymotionVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  durationSeconds: number | null;
  publishedAt: string | null;
  views: number | null;
  /** The best format offered, ranked — only ever used to choose between copies of one video. */
  quality: number | null;
}

export function validDailymotionVideoId(value: string): boolean {
  return VIDEO_ID.test(value);
}

/**
 * A channel, named either way.
 *
 * Their API answers to both: the canonical id — `x5rckqa` — and the username
 * the address bar shows, which is `dm_6a1dd2673c8d946116a65fa9f6` for that same
 * channel and `Cuisine.5.minutes` or `darbaar-royal-indian-cuisine` for others.
 * Search hands us the first, so links from here always worked; a reader pasting
 * a channel address has the second, and got told their channel was invalid.
 *
 * The grammar is wide, so what it refuses matters more than what it allows.
 * This value goes into a path we then fetch: a dot sequence in it would climb
 * out of that path, and a slash would leave the endpoint altogether.
 */
const CHANNEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function validDailymotionChannelId(value: string): boolean {
  return CHANNEL_ID.test(value) && !value.includes("..");
}

/** Only the hosts Dailymotion serves media from, so the proxy cannot be aimed elsewhere. */
export function isDailymotionMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return MEDIA_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

/**
 * Whether this result is one we could actually play.
 *
 * The search index keeps entries YouTube's equivalent would have dropped: asked
 * for "film complet", one result in fifteen answered 404 on its own endpoint —
 * "This video does not exist or has been deleted" — and yt-dlp said `Not found`
 * for it. Offering those is offering a card that cannot be pressed, which is
 * how this was reported.
 *
 * The dead one differed from its fourteen neighbours in a single field:
 * `allow_embed` was false where every live result had it true. That is also
 * exactly the right question to ask — not "does this exist" but "may we play
 * it" — so it is the one asked, alongside the two obvious ones.
 */
function playable(raw: Record<string, unknown>): boolean {
  if (raw.allow_embed === false) return false;
  if (raw.private === true) return false;
  return raw.status === undefined || raw.status === "published";
}

/**
 * The addresses to play, whether yt-dlp answered with one or two.
 *
 * A muxed video has its address at the root. A video whose audio is a separate
 * rendition has none there at all — which read as "no usable address" and
 * answered 502 on every attempt — and yt-dlp's chosen pair sits in
 * `requested_formats` instead, told apart by which codec each says it lacks.
 */
export function chosenStreams(metadata: Record<string, unknown>): { streamUrl: string; audioUrl: string | null } {
  const root = typeof metadata.url === "string" ? metadata.url : "";
  if (root) return { streamUrl: root, audioUrl: null };
  const chosen = Array.isArray(metadata.requested_formats) ? metadata.requested_formats as Record<string, unknown>[] : [];
  const address = (format: Record<string, unknown> | undefined) => typeof format?.url === "string" ? format.url : "";
  const video = chosen.find((format) => format.vcodec && format.vcodec !== "none");
  const audio = chosen.find((format) => format.acodec !== "none" && (!format.vcodec || format.vcodec === "none"));
  return { streamUrl: address(video), audioUrl: address(audio) || null };
}

/**
 * The title without the site's own name stuck on the end.
 *
 * Their related list hands back titles ending in " - Video Dailymotion", which
 * is a page title rather than a video's. It is noise in a card and it defeats
 * any comparison between two of them.
 */
export function cleanTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s*[-–—]\s*video dailymotion\s*$/i, "").trim();
}

/** Their ladder, lowest first. Anything unnamed ranks below all of them. */
const FORMAT_RANK: Record<string, number> = { ld: 1, sd: 2, hq: 3, hd720: 4, hd1080: 5, hd1440: 6, hd2160: 7 };

function bestFormat(raw: unknown): number | null {
  if (!Array.isArray(raw)) return null;
  let best = 0;
  for (const name of raw) {
    const rank = typeof name === "string" ? FORMAT_RANK[name] ?? 0 : 0;
    if (rank > best) best = rank;
  }
  return best || null;
}

/**
 * The same video, listed again under a different id.
 *
 * Reuploads are how this catalogue works. On one video's suggestions, five
 * results were the same film under five ids, and comparing whole titles caught
 * only some of them: the copies differ past the fiftieth character, where a
 * card's ellipsis is anyway.
 *
 * So the key is the start of the title and the exact duration together. Both
 * are needed. Titles alone would merge these, which are two different clips:
 *
 *     xnqymu  30s  Underworld : Nouvelle Ère … - Spot TV: Ne…
 *     xnqymf  17s  Underworld : Nouvelle Ère … - Spot TV: Ne…
 *
 * and duration alone would merge every eight-minute video on the site.
 *
 * Which copy is kept matters, because they are not interchangeable. Counted
 * over five searches, fifty groups had more than one copy and seven of those
 * offered different formats — and in five of the seven the copy that arrived
 * first was the poorer one. So the place in the list is Dailymotion's, and
 * belongs to whichever copy they ranked first, but the copy filling it is the
 * one that plays best. Only a strictly better format takes the place; a tie
 * leaves their ranking alone.
 *
 * Subtitles would be worth ranking on too and cannot be: no field on the video
 * carries them, only a sub-resource, and a group of nine copies would cost
 * nine requests to compare before a page could be drawn.
 */
const TITLE_KEY_LENGTH = 50;

export function dropDuplicateVideos<T extends { title: string; durationSeconds?: number | null; quality?: number | null }>(items: readonly T[]): T[] {
  const place = new Map<string, number>();
  const kept: T[] = [];
  for (const item of items) {
    const title = item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!title) continue;
    const key = `${title.slice(0, TITLE_KEY_LENGTH)}|${item.durationSeconds ?? "?"}`;
    const held = place.get(key);
    if (held === undefined) {
      place.set(key, kept.length);
      kept.push(item);
      continue;
    }
    if ((item.quality ?? 0) > (kept[held].quality ?? 0)) kept[held] = item;
  }
  return kept;
}

function toVideo(raw: Record<string, unknown>): DailymotionVideo | null {
  const videoId = typeof raw.id === "string" ? raw.id : "";
  if (!validDailymotionVideoId(videoId) || !playable(raw)) return null;
  const seconds = Number(raw.duration);
  const created = Number(raw.created_time);
  const views = Number(raw.views_total);
  return {
    videoId,
    title: cleanTitle(raw.title) || videoId,
    channelTitle: typeof raw["owner.screenname"] === "string" ? raw["owner.screenname"] : "",
    thumbnail: typeof raw.thumbnail_360_url === "string" ? raw.thumbnail_360_url : "",
    durationSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    publishedAt: Number.isFinite(created) ? new Date(created * 1000).toISOString() : null,
    views: Number.isFinite(views) ? views : null,
    quality: bestFormat(raw.available_formats),
  };
}

export interface DailymotionChannel {
  channelId: string;
  name: string;
  avatar: string;
  videos: number | null;
  followers: number | null;
}

export interface DailymotionSearch {
  videos: DailymotionVideo[];
  channels: DailymotionChannel[];
  live: DailymotionVideo[];
}

const CHANNEL_FIELDS = "id,screenname,avatar_120_url,videos_total,followers_total";

function toChannel(raw: Record<string, unknown>): DailymotionChannel | null {
  const channelId = typeof raw.id === "string" ? raw.id : "";
  if (!validDailymotionVideoId(channelId)) return null;
  const videos = Number(raw.videos_total);
  const followers = Number(raw.followers_total);
  return {
    channelId,
    name: typeof raw.screenname === "string" ? raw.screenname : channelId,
    avatar: typeof raw.avatar_120_url === "string" ? raw.avatar_120_url : "",
    videos: Number.isFinite(videos) ? videos : null,
    followers: Number.isFinite(followers) ? followers : null,
  };
}

async function askDailymotion(path: string, fetchImpl: typeof fetch): Promise<Record<string, unknown>[]> {
  const response = await fetchImpl(`https://api.dailymotion.com/${path}`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Dailymotion answered ${response.status}`);
  const payload = await response.json() as { list?: Record<string, unknown>[] };
  return payload.list ?? [];
}

/**
 * One search, several shelves — the shape their own results page has.
 *
 * Playlists are missing on purpose rather than by oversight: `/playlists?search=`
 * answers 403, "Only authenticated users can use this filter". A playlist of a
 * known channel is public and fetchable; searching for one is not, and this
 * experiment holds no API key.
 *
 * Each shelf is asked for separately and independently: a search that finds no
 * channels should still show its videos, so one failure does not empty the page.
 */
export async function searchDailymotionAll(query: string, fetchImpl: typeof fetch = fetch, limit?: number): Promise<DailymotionSearch> {
  const term = encodeURIComponent(query);
  const [videos, channels, live] = await Promise.all([
    searchDailymotion(query, limit, fetchImpl).catch(() => []),
    askDailymotion(`users?search=${term}&limit=8&fields=${encodeURIComponent(CHANNEL_FIELDS)}`, fetchImpl)
      .then((list) => list.map(toChannel).filter((channel): channel is DailymotionChannel => channel !== null))
      .catch(() => []),
    askDailymotion(`videos?search=${term}&live_onair=true&limit=8&fields=${encodeURIComponent(SEARCH_FIELDS)}`, fetchImpl)
      .then((list) => list.map(toVideo).filter((video): video is DailymotionVideo => video !== null))
      .catch(() => []),
  ]);
  return { videos, channels, live };
}

export interface DailymotionPlaylist {
  playlistId: string;
  name: string;
  thumbnail: string;
  videos: number | null;
}

export interface DailymotionChannelPage {
  channel: DailymotionChannel & { description: string };
  videos: DailymotionVideo[];
  playlists: DailymotionPlaylist[];
}

/**
 * A channel: who they are, what they posted, what they grouped.
 *
 * Playlists reappear here, which is where they were always going to. Searching
 * for one needs an account — `/playlists?search=` answers 403 — but a named
 * channel's own are public, so the way to reach a playlist is through whoever
 * made it.
 *
 * The three are asked for independently: a channel with no playlists still
 * shows its videos.
 */
export async function dailymotionChannelPage(channelId: string, fetchImpl: typeof fetch = fetch): Promise<DailymotionChannelPage | null> {
  const fields = `${CHANNEL_FIELDS},description`;
  const response = await fetchImpl(
    `https://api.dailymotion.com/user/${encodeURIComponent(channelId)}?fields=${encodeURIComponent(fields)}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) return null;
  const raw = await response.json() as Record<string, unknown>;
  const channel = toChannel(raw);
  if (!channel) return null;
  const [videos, playlists] = await Promise.all([
    askDailymotion(`user/${encodeURIComponent(channelId)}/videos?limit=60&sort=recent&fields=${encodeURIComponent(SEARCH_FIELDS)}`, fetchImpl)
      .then((list) => dropDuplicateVideos(list.map(toVideo).filter((video): video is DailymotionVideo => video !== null)))
      .catch(() => []),
    askDailymotion(`user/${encodeURIComponent(channelId)}/playlists?limit=30&fields=id,name,videos_total,thumbnail_240_url`, fetchImpl)
      .then((list) => list.map((item) => ({
        playlistId: typeof item.id === "string" ? item.id : "",
        name: typeof item.name === "string" ? item.name : "",
        thumbnail: typeof item.thumbnail_240_url === "string" ? item.thumbnail_240_url : "",
        videos: Number.isFinite(Number(item.videos_total)) ? Number(item.videos_total) : null,
      })).filter((playlist) => playlist.playlistId && playlist.name))
      .catch(() => []),
  ]);
  return {
    channel: { ...channel, description: plainDescription(raw.description) },
    videos,
    playlists,
  };
}

/** What a player page shows around the picture. */
export async function dailymotionVideoDetail(videoId: string, fetchImpl: typeof fetch = fetch): Promise<DailymotionVideo & { description: string } | null> {
  const fields = `${SEARCH_FIELDS},description,owner.avatar_120_url`;
  const response = await fetchImpl(
    `https://api.dailymotion.com/video/${encodeURIComponent(videoId)}?fields=${encodeURIComponent(fields)}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) return null;
  const raw = await response.json() as Record<string, unknown>;
  const video = toVideo(raw);
  return video ? { ...video, description: plainDescription(raw.description) } : null;
}

/**
 * Their description, as text.
 *
 * The API answers with markup — `<br />` between paragraphs — which a page that
 * prints it verbatim shows as `<br />`. Line breaks become line breaks and the
 * rest of the tags go; nothing here renders HTML from a third party.
 */
export function plainDescription(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Their own suggestions — and most of them are dead.
 *
 * Asked for twenty on the video this was noticed on, eighteen came back
 * unplayable: `allow_embed: false`, which their own detail endpoint confirms as
 * "This video does not exist or has been deleted", and yt-dlp as `Not found`.
 * Keeping only what plays left two, which is what the column showed.
 *
 * The filter is right; the sample was too small. Asked wider, the survivors
 * arrive:
 *
 *     limit 20  →  20 returned,   2 playable
 *     limit 50  →  50 returned,   9 playable
 *     limit 100 →  97 returned,  24 playable
 *
 * So a hundred are asked for and the playable ones kept. It is one request
 * either way, and the alternative is a column of cards that cannot be pressed.
 */
export async function dailymotionRelated(videoId: string, fetchImpl: typeof fetch = fetch): Promise<DailymotionVideo[]> {
  const list = await askDailymotion(
    `video/${encodeURIComponent(videoId)}/related?limit=100&fields=${encodeURIComponent(SEARCH_FIELDS)}`,
    fetchImpl,
  );
  return dropDuplicateVideos(list.map(toVideo).filter((video): video is DailymotionVideo => video !== null));
}

const nothing = (): Record<string, unknown>[] => [];

/** Their maximum, and the only size worth asking for: a page costs the same whatever it holds. */
const SEARCH_PAGE = 100;
/** Pages asked for together when the ones already read fall short. */
const SEARCH_BATCH = 4;
/** Their index stops at a thousand, which is ten pages of a hundred. */
const SEARCH_MAX_PAGE = 10;
/** As many cards as a results page is worth scrolling. More is a slower page, not a better one. */
const SEARCH_ENOUGH = 60;

/**
 * Both ways of asking, because one of them is quietly biased.
 *
 * Two videos reported missing — "Luna Réincarnée…", "L\'Alpha est mort Luna…"
 * — are published, embeddable and in 720p, and neither appears anywhere in the
 * thousand results their search will return for "alpha luna". Naming the
 * language finds them at once, and turns thirty-three results into three
 * hundred and thirty-three. Their index does not hide French videos; it ranks
 * them below what it takes the caller to want.
 *
 * So the plain question is asked as well as the same question in the language
 * the library is kept in, and the two answers are merged. The plain one comes
 * first: it is their own ranking, and the point is to add to it.
 */
function searchScopes(): string[] {
  return ["", `&languages=${libraryLanguage()}`];
}

async function searchPage(query: string, page: number, scope: string, fetchImpl: typeof fetch): Promise<Record<string, unknown>[]> {
  const url = `${SEARCH_API}?search=${encodeURIComponent(query)}&limit=${SEARCH_PAGE}&page=${page}`
    + `&fields=${encodeURIComponent(SEARCH_FIELDS)}&sort=relevance${scope}`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Dailymotion search failed (${response.status})`);
  const payload = await response.json() as { list?: Record<string, unknown>[] };
  return payload.list ?? [];
}

/**
 * What they have, rather than the first handful of it.
 *
 * Searching "alpha luna" here returned a few cards against a full page on
 * dailymotion.com. Neither of the two filters was at fault: every sampled
 * result rejected for `allow_embed` answered 404 on its own endpoint, and one
 * of the titles dropped as a duplicate had been posted by nine different
 * channels at the same duration. What was wrong is how little was asked for.
 *
 *     asked        returned   still play   after reuploads
 *     24 (before)     24          5              4
 *     100            100         15              9
 *     500, 5 pages   394         62             25
 *
 * Depth is close to free: asked for together, five pages came back in 708ms
 * against 756ms for one. So a first page that fills the grid is the whole
 * cost — "france info" fills on its own — and only a query whose results have
 * rotted pays for the rest. Their pages overlap, so ids are counted once.
 */
export async function searchDailymotion(query: string, limit?: number, fetchImpl: typeof fetch = fetch): Promise<DailymotionVideo[]> {
  // No ceiling of its own beyond what is asked for: scrolling asks for more,
  // and a cap here would stop the page while their index still had answers.
  const wanted = Number.isFinite(limit) ? Math.max(1, Math.trunc(limit as number)) : SEARCH_ENOUGH;
  const seen = new Set<string>();
  const keep = (raw: Record<string, unknown>[]): DailymotionVideo[] => raw
    .filter((item) => {
      const id = typeof item.id === "string" ? item.id : "";
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map(toVideo)
    .filter((video): video is DailymotionVideo => video !== null);

  const scopes = searchScopes();
  // The plain first page is the one allowed to fail out loud: a search that
  // cannot be run should say so rather than answer nothing. The rest is extra.
  const opening = [
    await searchPage(query, 1, scopes[0], fetchImpl),
    ...await Promise.all(scopes.slice(1).map((scope) => searchPage(query, 1, scope, fetchImpl).catch(nothing))),
  ];
  const found = opening.flatMap(keep);
  for (let next = 2; dropDuplicateVideos(found).length < wanted && next <= SEARCH_MAX_PAGE; next += SEARCH_BATCH) {
    const reach = Math.min(SEARCH_BATCH, SEARCH_MAX_PAGE - next + 1);
    const deeper = await Promise.all(scopes.flatMap((scope) => Array.from(
      { length: reach },
      (_, index) => searchPage(query, next + index, scope, fetchImpl).catch(nothing),
    )));
    const before = found.length;
    for (const page of deeper) found.push(...keep(page));
    // Their pages overlap, and past a point they repeat entirely. A batch that
    // brings nothing new is the end of what they have, whatever the page says.
    if (found.length === before) break;
  }
  return dropDuplicateVideos(found).slice(0, wanted);
}

export interface DailymotionSubtitle {
  /** Dailymotion's own tag: "fr", "fr-auto", "und". */
  lang: string;
  label: string;
  /** Where the track really lives; only ever fetched by our own proxy. */
  url: string;
  srt: boolean;
}

export interface DailymotionSource {
  streamUrl: string;
  /**
   * The audio, when it is not in the video stream.
   *
   * Most of their catalogue is muxed and yt-dlp answers with one address. Some
   * videos are not: the picture comes in `hls-380/480/720`, each `acodec: none`,
   * and the sound in `hls-0_aac_q2-English` beside it. There is no muxed
   * rendition to fall back on, so the two are carried separately and the master
   * playlist puts them back together.
   */
  audioUrl: string | null;
  subtitles: DailymotionSubtitle[];
  durationSeconds: number | null;
  /** What the one rendition is, for a master playlist Apple's player will accept. */
  rendition: { width: number | null; height: number | null; codecs: string | null; bitrate: number | null };
}

const sourceCache = new Map<string, { expiresAt: number; source: Promise<DailymotionSource> }>();

function subtitleLabel(lang: string): string {
  const automatic = lang.endsWith("-auto");
  const base = automatic ? lang.slice(0, -5) : lang;
  if (base === "und") return automatic ? "Original (auto)" : "Original";
  const name = new Intl.DisplayNames(["fr"], { type: "language" }).of(base) ?? base;
  const capitalised = name.charAt(0).toUpperCase() + name.slice(1);
  return automatic ? `${capitalised} (auto)` : capitalised;
}

/**
 * The tracks worth offering, out of what yt-dlp found.
 *
 * Dailymotion publishes the same captions twice: once as a plain file and once
 * as an HLS playlist of WebVTT segments. Only the file is taken. Stitching the
 * segmented one means concatenating fragments that each carry their own header
 * and timestamp map, and getting that subtly wrong shows as subtitles drifting
 * rather than as an error — not worth it while the other form is right there.
 *
 * Their public API is no help here at all: for the video this was reported on
 * it answers `"total": 0` while yt-dlp finds two.
 */
export function subtitlesFromMetadata(metadata: Record<string, unknown>): DailymotionSubtitle[] {
  const groups = [metadata.subtitles, metadata.automatic_captions];
  const found = new Map<string, DailymotionSubtitle>();
  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    for (const [lang, tracks] of Object.entries(group as Record<string, unknown>)) {
      if (found.has(lang) || !Array.isArray(tracks)) continue;
      for (const track of tracks as Record<string, unknown>[]) {
        const url = typeof track?.url === "string" ? track.url : "";
        if (!url || !isDailymotionMediaUrl(url) || url.includes(".m3u8")) continue;
        found.set(lang, { lang, label: subtitleLabel(lang), url, srt: url.includes(".srt") || track.ext === "srt" });
        break;
      }
    }
  }
  return [...found.values()];
}

/**
 * Everything one playback needs, from one subprocess.
 *
 * `-J` answers with the playable address and the caption tracks together, and
 * costs the same as `-g` did for the address alone — measured at 0.74s against
 * 0.76s. The answer is cached for a minute so the segments of one playback
 * share a lookup: resolving per segment would spend a subprocess every three
 * seconds of video.
 */
export function resolveDailymotion(videoId: string, { fresh = false }: { fresh?: boolean } = {}): Promise<DailymotionSource> {
  const cached = sourceCache.get(videoId);
  const now = Date.now();
  if (!fresh && cached && cached.expiresAt > now) return cached.source;
  const source = (async () => {
    const proc = Bun.spawn([YTDLP, "-J", "--skip-download", "--no-warnings", `https://www.dailymotion.com/video/${videoId}`], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    if (await proc.exited !== 0) throw new Error(err.trim().split("\n").pop() || "yt-dlp could not resolve the video");
    const metadata = JSON.parse(out) as Record<string, unknown>;
    const { streamUrl, audioUrl } = chosenStreams(metadata);
    if (!isDailymotionMediaUrl(streamUrl)) throw new Error("yt-dlp returned no usable address");
    const subtitles = subtitlesFromMetadata(metadata);
    const seconds = Number(metadata.duration);
    const number = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
    const codec = (value: unknown) => typeof value === "string" && value && value !== "none" ? value : null;
    const codecs = [codec(metadata.vcodec), codec(metadata.acodec)].filter(Boolean).join(",");
    log.info("dailymotion.resolved", { videoId, subtitles: subtitles.length });
    return {
      streamUrl,
      audioUrl,
      subtitles,
      durationSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
      rendition: {
        width: number(metadata.width),
        height: number(metadata.height),
        codecs: codecs || null,
        bitrate: number(metadata.tbr) ? Math.round(Number(metadata.tbr) * 1000) : null,
      },
    };
  })();
  sourceCache.set(videoId, { expiresAt: now + STREAM_TTL_MS, source });
  source.catch(() => sourceCache.delete(videoId));
  return source;
}

export async function resolveDailymotionStream(videoId: string): Promise<string> {
  return (await resolveDailymotion(videoId)).streamUrl;
}

/**
 * The same playlist, pointing at us instead of at Dailymotion.
 *
 * Its segment lines are relative, and the CDN sends no CORS header — so a
 * player fetching them from this origin is refused, and one fetching them
 * directly leaks a signed URL into the page. Both are answered by rewriting
 * every URI to an absolute address behind our own proxy. Attribute URIs are
 * rewritten too: no Dailymotion playlist seen here carries a key, and one that
 * did would otherwise fail silently.
 */
export function rewriteHlsPlaylist(playlist: string, playlistUrl: string, proxy: (absolute: string) => string): string {
  const absolute = (reference: string) => {
    try { return new URL(reference, playlistUrl).toString(); } catch { return reference; }
  };
  return playlist.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (!trimmed.startsWith("#")) return proxy(absolute(trimmed));
    return line.replace(/URI="([^"]+)"/g, (_match, reference: string) => `URI="${proxy(absolute(reference))}"`);
  }).join("\n");
}

/**
 * A master playlist, so the captions are part of the stream rather than beside it.
 *
 * Sideloaded <track> elements are a page's business, and on iOS the page does
 * not play the video: Safari hands it to the system player, which reads the
 * manifest and nothing else. A reader there had no subtitle button at all. What
 * that player will offer is a rendition group, so that is what is written.
 *
 * hls.js reads the same thing on every other browser, which means one mechanism
 * instead of two — the <track> elements can go.
 */
export function masterPlaylist(
  mediaUrl: string,
  subtitles: readonly { lang: string; label: string; url: string }[],
  rendition: { width?: number | null; height?: number | null; codecs?: string | null; bitrate?: number | null } = {},
  audioUrl: string | null = null,
): string {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];
  /*
   * A separate audio rendition, declared as a group. Without it the player is
   * handed a picture with no sound and no idea one exists.
   */
  if (audioUrl) {
    lines.push(`#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="${audioUrl}"`);
  }
  /*
   * Offered, never imposed.
   *
   * `DEFAULT=YES` says "play this unless the reader has said otherwise", and
   * iOS re-reads it: switching the subtitles off and then skipping forward ten
   * seconds brought them straight back. AUTOSELECT would do the same from the
   * phone's own accessibility settings. Off means off, and the player's own
   * menu is where they get turned on.
   */
  for (const track of subtitles) {
    const language = track.lang.replace(/-auto$/, "");
    lines.push(
      `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="${track.label.replaceAll('"', "")}",`
      + `LANGUAGE="${language}",AUTOSELECT=NO,DEFAULT=NO,URI="${track.url}"`,
    );
  }
  /*
   * Bandwidth is the only required attribute and nothing chooses on it — there
   * is one rendition. The rest is stated anyway: Apple's player is the one that
   * has to read this on iOS, and it is the stricter reader of the two.
   */
  const attributes = [`BANDWIDTH=${rendition.bitrate ?? 800_000}`];
  if (rendition.width && rendition.height) attributes.push(`RESOLUTION=${rendition.width}x${rendition.height}`);
  if (rendition.codecs) attributes.push(`CODECS="${rendition.codecs}"`);
  if (audioUrl) attributes.push('AUDIO="aud"');
  if (subtitles.length > 0) attributes.push('SUBTITLES="subs"');
  lines.push(`#EXT-X-STREAM-INF:${attributes.join(",")}`);
  lines.push(mediaUrl);
  return `${lines.join("\n")}\n`;
}

/**
 * One WebVTT file, presented as a playlist.
 *
 * A subtitle rendition has to be a playlist even when the captions are a single
 * file, so it is one segment as long as the video. The duration is stated
 * generously — a segment shorter than the video would end the track early, and
 * players do not mind one that outlasts it.
 */
export function subtitlePlaylist(trackUrl: string, durationSeconds: number | null): string {
  const duration = Math.ceil(durationSeconds && durationSeconds > 0 ? durationSeconds : 86_400);
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    `#EXT-X-TARGETDURATION:${duration}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    `#EXTINF:${duration}.000,`,
    trackUrl,
    "#EXT-X-ENDLIST",
    "",
  ].join("\n");
}

/**
 * The same segment, asked for with a fresh signature.
 *
 * Dailymotion signs a whole path — `…/sec2(TOKEN)/video/244/911/…` — and the
 * playlist we hand the player embeds that signature in every segment address.
 * The player holds that playlist for as long as it is watching, so a signature
 * that expires takes the rest of the video with it: what is already buffered
 * plays, and anything not yet fetched answers 403. Seeking an hour ahead is the
 * fastest way to find out.
 *
 * Both addresses come from the same CDN and differ in that one component, so a
 * newly resolved stream is enough to rebuild any segment of it.
 */
export function reSignSegmentUrl(segmentUrl: string, freshStreamUrl: string): string | null {
  const signature = /\/sec\d*\([^)]*\)\//;
  const fresh = freshStreamUrl.match(signature)?.[0];
  if (!fresh || !signature.test(segmentUrl)) return null;
  const rebuilt = segmentUrl.replace(signature, fresh);
  return rebuilt === segmentUrl ? null : rebuilt;
}
