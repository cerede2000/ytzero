import { searchDailymotionAll, type DailymotionChannel, type DailymotionVideo } from "./dailymotion";
import { SEARCH_PROVIDERS, type SearchProviderDescription } from "./searchProviderCatalog";
import { log } from "./logger";
import { persistSetCookies } from "./youtubeCookieHealth";
import { youtubeCookieHeader } from "./youtubeCookieHeader";
import { searchDeeper, searchYouTube, type ChannelSearchResult, type SearchResult } from "./youtube";

export interface ProviderSearch {
  results: SearchResult[];
  channels: ChannelSearchResult[];
  /** Whether this provider has anything past the window just returned. */
  more: boolean;
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
/**
 * How much each provider is asked for, so that a page is balanced and full.
 *
 * The first merged page ran thirteen alternating pairs and then forty-seven
 * straight Dailymotion cards: Dailymotion had been asked for sixty and
 * YouTube's scraper stops at twenty. Trimming Dailymotion to match would have
 * balanced it by making the page emptier, so YouTube is asked to go deeper
 * instead — its results page hangs the rest off a continuation token, the same
 * way the channel posts scraper already follows one.
 *
 * Forty each is what two continuations reliably reach, and eighty mixed cards
 * is a page worth scrolling. A provider on its own is asked for the same
 * forty: a filter should narrow what is shown, not change how much there is.
 */
const PER_PROVIDER = 40;

export function providerCeiling(): number {
  return PER_PROVIDER;
}

/**
 * How many channels one provider may put above the videos.
 *
 * Not the same question as the videos below. A channel row is a way to jump to
 * a channel, not a shelf to browse: YouTube itself shows one for "arte". Asked
 * for eight each, a topical query put two YouTube rows beside eight
 * Dailymotion ones and the shelf read as somebody else's search.
 */
const PER_PROVIDER_CHANNELS = 3;

export async function searchAcrossProviders(
  query: string,
  providers: readonly SearchProviderDescription[],
  page = 1,
  /*
   * Whose search this is.
   *
   * Anonymous, the YouTube provider is a scraper and is throttled as one, which
   * is what ends its depth long before its index. Asked as the reader, it is a
   * browser. Their own jar only: a ranking made for an account is that
   * account's, and lending it would hand one person's habits to the next.
   */
  reader: number | null = null,
): Promise<{ found: Record<string, ProviderSearch>; failed: string[] }> {
  const jar = reader ? youtubeCookieHeader(reader) : null;
  const per = providerCeiling();
  const upTo = Math.max(1, Math.trunc(page)) * per;
  const from = upTo - per;
  const found: Record<string, ProviderSearch> = {};
  const failed: string[] = [];
  await Promise.all(providers.map(async (provider) => {
    try {
      found[provider.id] = await runProvider(provider.id, query, from, upTo, reader && jar
        ? {
          id: reader,
          cookieHeader: jar,
          /*
           * A browser writes back what a page rotated, which is how a session
           * stays a session. Nothing here did: the jar was only ever renewed
           * by somebody opening a video or the page that displays its health,
           * so between two such moments it aged untouched. A signed-in search
           * is traffic we now make anyway, and its answers carry the same
           * rotations.
           *
           * Only while the account is still known — writing what YouTube
           * hands a stranger over the remains of an account is not a repair,
           * and the guard for that lives with the jar.
           */
          onSetCookies: (setCookies) => persistSetCookies(reader, setCookies),
        }
        : null);
    } catch (error) {
      // Named, because a provider that answers nothing and a provider that was
      // refused look the same on the page and need opposite fixes.
      log.warn("search.provider_failed", { provider: provider.id, error: error instanceof Error ? error.message : String(error) });
      failed.push(provider.id);
    }
  }));
  return { found, failed };
}

async function runProvider(
  id: string,
  query: string,
  from: number,
  upTo: number,
  reader: { id: number; cookieHeader: string; onSetCookies: (setCookies: string[]) => void } | null,
): Promise<ProviderSearch> {
  if (id === "youtube") {
    const deep = await searchDeeper(query, upTo, reader).catch((error: unknown) => {
      log.warn("search.youtube_deep_failed", {
        signedIn: Boolean(reader),
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
    // Its results page drops the channel card for a channel-name query, and
    // only the shallow search knows to ask again with the channel filter. It
    // is cached, so this costs a request in that case and nothing in the rest.
    if (deep?.results.length && deep.channels.length) {
      return {
        results: deep.results.slice(from, upTo),
        channels: from ? [] : deep.channels.slice(0, PER_PROVIDER_CHANNELS),
        more: deep.more,
      };
    }
    const shallow = await searchYouTube(query);
    const results = deep?.results.length ? deep.results : shallow.results;
    return {
      results: results.slice(from, upTo),
      // A later page is more of the list, not another copy of what is above it.
      channels: from ? [] : shallow.channels.slice(0, PER_PROVIDER_CHANNELS),
      more: deep?.more ?? results.length > upTo,
    };
  }
  if (id === "dailymotion") {
    // One past the window, which is how a page knows there is another.
    const { videos, channels } = await searchDailymotionAll(query, fetch, upTo + 1);
    return {
      results: videos.slice(from, upTo).map(dailymotionResult),
      channels: from ? [] : channels.slice(0, PER_PROVIDER_CHANNELS).map(dailymotionChannelResult),
      more: videos.length > upTo,
    };
  }
  throw new Error(`no such search provider: ${id}`);
}

export { SEARCH_PROVIDERS };
