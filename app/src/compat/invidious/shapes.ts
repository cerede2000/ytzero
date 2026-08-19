import { durationSeconds } from "../../shortClassification";
import { relativePublishedAt, type PublishedAgo, type SearchResult, type ChannelSearchResult } from "../../youtube";

/**
 * Turning what this server knows into the documents Invidious clients decode.
 *
 * Pure on purpose: every function here takes plain values and returns plain
 * values, so the shapes a client depends on can be asserted without a database,
 * a network, or a running server. The route handlers stay a lookup and a call.
 *
 * Two fields decide whether a client works at all. `lengthSeconds` is not
 * optional in Yattee's model, and one video missing it fails the decode of the
 * whole list it arrived in — so it is always a number, zero when genuinely
 * unknown. `authorId` is likewise required, and empty rather than absent for a
 * result whose channel we were not told.
 */

export interface InvidiousThumbnail {
  quality: string;
  url: string;
  width: number;
  height: number;
}

/** The sizes a client may pick from, best first — clients take the first. */
export function videoThumbnails(videoId: string, stored: string | null | undefined): InvidiousThumbnail[] {
  const derived: InvidiousThumbnail[] = [
    { quality: "maxres", url: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`, width: 1280, height: 720 },
    { quality: "high", url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, width: 480, height: 360 },
    { quality: "medium", url: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`, width: 320, height: 180 },
    { quality: "default", url: `https://i.ytimg.com/vi/${videoId}/default.jpg`, width: 120, height: 90 },
  ];
  /*
   * The stored image wins the first slot when we have one. It is the frame the
   * uploader chose — a designed thumbnail lives under a signed, numbered name
   * that cannot be derived from the id, and deriving one anyway would quietly
   * downgrade every card to the generic frame.
   *
   * When it is one of the derived names after all, it is moved rather than
   * added: two entries claiming to be the same quality is a list a client picks
   * from wrongly.
   */
  if (!stored) return derived;
  const known = derived.find((thumbnail) => thumbnail.url === stored);
  if (known) return [known, ...derived.filter((thumbnail) => thumbnail !== known)];
  return [{ quality: "maxres", url: stored, width: 1280, height: 720 }, ...derived];
}

/**
 * A subscriber count as a number, from the text YouTube drew.
 *
 * The library keeps what was scraped — "1.2M subscribers", "12 k abonnés" —
 * because that is what the web interface shows. Clients want an integer, and
 * an approximation of the right magnitude is closer to the truth than the zero
 * that "unknown" would have to mean.
 */
export function subscriberCount(text: string | null | undefined): number {
  if (!text) return 0;
  const cleaned = text.replace(/\u00a0|\u202f/g, " ").replace(/,(\d)/, ".$1");
  const match = /(\d+(?:\.\d+)?)\s*([kKmMbB])?/.exec(cleaned);
  if (!match) return 0;
  const scale = { k: 1e3, m: 1e6, b: 1e9 }[(match[2] ?? "").toLowerCase()] ?? 1;
  return Math.round(Number(match[1]) * scale);
}

export function channelThumbnails(url: string | null | undefined): InvidiousThumbnail[] {
  if (!url) return [];
  return [512, 176, 88, 48].map((size) => ({ quality: `${size}`, url, width: size, height: size }));
}

/** Unix seconds from the date column, or null when the row carries no date. */
function publishedSeconds(publishedAt: string | null | undefined): number | null {
  if (!publishedAt) return null;
  const ms = Date.parse(publishedAt);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * The phrase a scraped result carries instead of a date.
 *
 * YouTube search says "2 years ago" and never the day. Clients show this text
 * when it is there and fall back to formatting the timestamp when it is not,
 * so passing it through keeps a search result as informative as it was.
 */
function publishedTextFrom(published: PublishedAgo | null | undefined): string | undefined {
  if (!published) return undefined;
  const value = Math.max(0, Math.round(published.value));
  return `${value} ${published.unit}${value === 1 ? "" : "s"} ago`;
}

export interface VideoRowLike {
  video_id: string;
  title: string;
  description?: string | null;
  thumbnail?: string | null;
  published_at?: string | null;
  live_status?: string | null;
  views?: number | null;
  likes?: number | null;
  duration?: string | null;
  channel_id: string;
  channel_title?: string | null;
}

export interface InvidiousVideo {
  type: "video";
  videoId: string;
  title: string;
  author: string;
  authorId: string;
  authorUrl: string;
  lengthSeconds: number;
  videoThumbnails: InvidiousThumbnail[];
  description?: string;
  published?: number;
  publishedText?: string;
  viewCount?: number;
  likeCount?: number;
  liveNow: boolean;
  isUpcoming: boolean;
}

/** A library row as a client's list entry. */
export function videoFromRow(row: VideoRowLike): InvidiousVideo {
  const published = publishedSeconds(row.published_at);
  return {
    type: "video",
    videoId: row.video_id,
    title: row.title,
    author: row.channel_title ?? "",
    authorId: row.channel_id,
    authorUrl: `/channel/${row.channel_id}`,
    lengthSeconds: durationSeconds(row.duration) ?? 0,
    videoThumbnails: videoThumbnails(row.video_id, row.thumbnail),
    description: row.description ?? "",
    ...(published === null ? {} : { published }),
    ...(row.views == null ? {} : { viewCount: row.views }),
    ...(row.likes == null ? {} : { likeCount: row.likes }),
    liveNow: row.live_status === "live",
    isUpcoming: row.live_status === "upcoming",
  };
}

/** A scraped search hit as a client's list entry. */
export function videoFromSearchResult(result: SearchResult, now = new Date()): InvidiousVideo {
  const at = result.publishedAt ?? (result.published ? relativePublishedAt(result.published, now) : null);
  const published = publishedSeconds(at);
  const publishedText = publishedTextFrom(result.published);
  return {
    type: "video",
    videoId: result.videoId,
    title: result.title,
    author: result.channelTitle,
    authorId: result.channelId ?? "",
    authorUrl: result.channelId ? `/channel/${result.channelId}` : "",
    lengthSeconds: durationSeconds(result.duration) ?? 0,
    videoThumbnails: videoThumbnails(result.videoId, result.thumbnail),
    ...(published === null ? {} : { published }),
    ...(publishedText === undefined ? {} : { publishedText }),
    ...(result.viewCount == null ? {} : { viewCount: result.viewCount }),
    liveNow: false,
    isUpcoming: false,
  };
}

export interface ChannelRowLike {
  channel_id: string;
  title?: string | null;
  custom_title?: string | null;
  description?: string | null;
  thumbnail?: string | null;
  banner?: string | null;
  subscriber_count?: string | number | null;
  video_count?: number | null;
}

export function channelFromRow(row: ChannelRowLike) {
  return {
    type: "channel" as const,
    authorId: row.channel_id,
    author: row.custom_title || row.title || "",
    authorUrl: `/channel/${row.channel_id}`,
    authorThumbnails: channelThumbnails(row.thumbnail),
    authorBanners: channelThumbnails(row.banner),
    authorVerified: false,
    description: row.description ?? "",
    descriptionHtml: row.description ?? "",
    subCount: typeof row.subscriber_count === "number" ? row.subscriber_count : subscriberCount(row.subscriber_count),
    videoCount: row.video_count ?? 0,
    totalViews: 0,
    isFamilyFriendly: true,
    allowedRegions: [],
    latestVideos: [] as InvidiousVideo[],
    relatedChannels: [] as unknown[],
  };
}

/** A scraped channel hit, which carries counts only as the text YouTube drew. */
export function channelFromSearchResult(channel: ChannelSearchResult) {
  return {
    type: "channel" as const,
    authorId: channel.channelId,
    author: channel.title,
    authorUrl: `/channel/${channel.channelId}`,
    authorThumbnails: channelThumbnails(channel.thumbnail),
    authorVerified: false,
    description: "",
    descriptionHtml: "",
    subCount: 0,
    videoCount: 0,
  };
}

export interface CommentLike {
  id: string;
  parent: string | null;
  text: string;
  author: string;
  authorId: string | null;
  authorThumbnail: string | null;
  timestamp: number | null;
  timeText: string | null;
  likeCount: number;
  isPinned: boolean;
  authorIsUploader: boolean;
}

/**
 * Comments as a client expects them: the top level only.
 *
 * yt-dlp hands back one flat list with a `parent` on each reply, and Invidious
 * hands back top-level comments each carrying a continuation token its replies
 * are fetched with. Rather than mint tokens for a thread nobody has asked for,
 * a comment says how many replies it has and stops there — a reply count with
 * no way to open it is honest; a thread claiming to be complete is not.
 */
export function commentsFrom(comments: CommentLike[]) {
  const replyCounts = new Map<string, number>();
  for (const comment of comments) {
    if (!comment.parent || comment.parent === "root") continue;
    replyCounts.set(comment.parent, (replyCounts.get(comment.parent) ?? 0) + 1);
  }
  return {
    commentCount: comments.length,
    videoId: "",
    comments: comments
      .filter((comment) => !comment.parent || comment.parent === "root")
      .map((comment) => ({
        commentId: comment.id,
        author: comment.author,
        authorId: comment.authorId ?? "",
        authorUrl: comment.authorId ? `/channel/${comment.authorId}` : "",
        authorThumbnails: channelThumbnails(comment.authorThumbnail),
        authorIsChannelOwner: comment.authorIsUploader,
        content: comment.text,
        contentHtml: comment.text,
        ...(comment.timestamp == null ? {} : { published: comment.timestamp }),
        ...(comment.timeText ? { publishedText: comment.timeText } : {}),
        likeCount: comment.likeCount,
        isEdited: false,
        isPinned: comment.isPinned,
        replies: replyCounts.has(comment.id)
          ? { replyCount: replyCounts.get(comment.id)!, continuation: "" }
          : undefined,
      })),
  };
}

/**
 * The qualities worth offering, once it is known what each one really is.
 *
 * A request for 360p on a video that has no 360p muxed file comes back with
 * whatever it does have — often the same file the 720p request returns. Left
 * alone, the document then offers one file twice under two labels, one of them
 * false, and a client picking "360p" downloads the larger file believing it
 * chose the smaller.
 *
 * So a quality whose real height is known is labelled with it, and two that
 * turn out to be the same thing are offered once. What is still unknown keeps
 * the optimistic label: it is the first time anybody has asked, and the answer
 * arrives with the file.
 */
export function labelledQualities(
  offered: readonly number[],
  known: (asked: number) => number | null,
): { asked: number; label: number }[] {
  const chosen: { asked: number; label: number }[] = [];
  for (const asked of offered) {
    const label = known(asked) ?? asked;
    if (chosen.some((quality) => quality.label === label)) continue;
    chosen.push({ asked, label });
  }
  return chosen;
}

export interface DailymotionVideoLike {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  durationSeconds: number | null;
  publishedAt: string | null;
  views: number | null;
}

/**
 * A Dailymotion video as a client's list entry.
 *
 * The dialect has no field for where a video came from, and a client drops
 * what it does not know — so the origin is written where it will be read: the
 * author line, which every card and every row draws. It is not decoration
 * either, since the channel really is a Dailymotion channel.
 *
 * The id carries the prefix nothing else can spell, which is what makes the
 * tap that follows land on the right provider.
 */
export function videoFromDailymotion(video: DailymotionVideoLike, prefixed: string): InvidiousVideo {
  const published = publishedSeconds(video.publishedAt);
  return {
    type: "video",
    videoId: prefixed,
    title: video.title,
    author: `${video.channelTitle} · Dailymotion`,
    // No channel of ours to link to: the dialect's channel routes speak the
    // library's id space, and a Dailymotion channel is not in it.
    authorId: "",
    authorUrl: "",
    lengthSeconds: Math.max(0, Math.round(video.durationSeconds ?? 0)),
    videoThumbnails: video.thumbnail
      ? [{ quality: "maxres", url: video.thumbnail, width: 1280, height: 720 }]
      : [],
    ...(published === null ? {} : { published }),
    ...(video.views == null ? {} : { viewCount: video.views }),
    liveNow: false,
    isUpcoming: false,
  };
}

/**
 * Two providers' answers in one list, taken in turn.
 *
 * The dialect returns a flat list and a client shows it in the order given, so
 * appending one provider after another buries the second: forty results deep
 * on a phone is not a result anybody sees. Taken in turn, each is on screen
 * from the first row, and a provider that runs out simply stops appearing.
 */
export function interleave<T>(lists: readonly (readonly T[])[]): T[] {
  const longest = Math.max(0, ...lists.map((list) => list.length));
  const mixed: T[] = [];
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) {
      if (index < list.length) mixed.push(list[index]);
    }
  }
  return mixed;
}
