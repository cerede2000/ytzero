import type { ChannelSearchResult, SearchResult } from "./apiTypes";

/**
 * A provider as the server describes it.
 *
 * The page builds its filter and its cards from this rather than from a list
 * of its own, so a provider added on the server appears here without this file
 * being told its name.
 */
export interface SearchProviderDescription {
  id: string;
  label: string;
  thumbnailHosts: string[];
  capabilities: { library: boolean; channelPages: boolean };
  /** Where a card leads; `:id` is the video id. */
  watchPath: string;
  channelPath: string | null;
}

export interface ExternalSearch {
  providers: Record<string, { results: SearchResult[]; channels: ChannelSearchResult[] }>;
  /** Providers that answered with nothing because they could not be reached. */
  failed: string[];
  downloads_allowed?: boolean;
  downloads_enabled?: boolean;
}

export function providerPath(template: string, id: string): string {
  return template.replace(":id", encodeURIComponent(id));
}

/**
 * One list from several, without inventing a ranking.
 *
 * Relevance is not a shared quantity: a provider's tenth result is not worse
 * than another's fifth, and no arithmetic here can make them comparable. So
 * the merge is by rank — every provider's first, then every provider's second
 * — which keeps each ordering intact and gives none of them the top of the
 * page for free.
 */
export function mergeByRank<T>(lists: readonly (readonly T[])[]): T[] {
  const merged: T[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let rank = 0; rank < longest; rank++) {
    for (const list of lists) {
      if (rank < list.length) merged.push(list[rank]);
    }
  }
  return merged;
}
