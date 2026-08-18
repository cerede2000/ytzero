import { searchDailymotionAll, type DailymotionChannel, type DailymotionVideo } from "./dailymotion";
import { SEARCH_PROVIDERS, type SearchProviderDescription } from "./searchProviderCatalog";
import { searchYouTube, type ChannelSearchResult, type SearchResult } from "./youtube";

export interface ProviderSearch {
  results: SearchResult[];
  channels: ChannelSearchResult[];
}

/** The clock a card prints, from the seconds a provider gave. */
export function durationClock(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "";
  const whole = Math.round(seconds);
  const parts = [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60];
  const [hours, minutes, rest] = parts;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

function dailymotionResult(video: DailymotionVideo): SearchResult {
  return {
    videoId: video.videoId,
    title: video.title,
    thumbnail: video.thumbnail,
    duration: durationClock(video.durationSeconds),
    channelId: null,
    channelTitle: video.channelTitle,
    channelAvatar: null,
    viewCount: video.views,
    // Their date is exact, so it travels as one; only YouTube needs the phrase.
    published: null,
    publishedAt: video.publishedAt,
  };
}

function dailymotionChannelResult(channel: DailymotionChannel): ChannelSearchResult {
  return {
    channelId: channel.channelId,
    title: channel.name,
    thumbnail: channel.avatar,
    handle: "",
    subscriberCount: channel.followers == null ? "" : String(channel.followers),
    // YouTube's is already a phrase ("12 videos"); a bare number beside it
    // reads as a stray digit, and the server has no language to name it in.
    videoCount: "",
  };
}

/**
 * One search per provider, run for whoever was asked for.
 *
 * Each is awaited beside the others and each is allowed to fail alone: a
 * provider that is down, rate-limited or simply slow must cost the page its
 * own results and nothing else. What comes back is keyed by provider, because
 * the page ranks within a provider and never across them — their relevance
 * scores are not the same quantity and there is no honest way to compare them.
 */
export async function searchAcrossProviders(
  query: string,
  providers: readonly SearchProviderDescription[],
): Promise<{ found: Record<string, ProviderSearch>; failed: string[] }> {
  const found: Record<string, ProviderSearch> = {};
  const failed: string[] = [];
  await Promise.all(providers.map(async (provider) => {
    try {
      found[provider.id] = await runProvider(provider.id, query);
    } catch {
      failed.push(provider.id);
    }
  }));
  return { found, failed };
}

async function runProvider(id: string, query: string): Promise<ProviderSearch> {
  if (id === "youtube") {
    const { results, channels } = await searchYouTube(query);
    return { results, channels };
  }
  if (id === "dailymotion") {
    const { videos, channels } = await searchDailymotionAll(query);
    return {
      results: videos.map(dailymotionResult),
      channels: channels.map(dailymotionChannelResult),
    };
  }
  throw new Error(`no such search provider: ${id}`);
}

export { SEARCH_PROVIDERS };
