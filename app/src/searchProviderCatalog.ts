/**
 * Who can be searched from here, described without depending on anything.
 *
 * Deliberately free of imports. The image proxy has to read the thumbnail
 * hosts, the routes have to read the capabilities, and the search itself has
 * to read both — a module that imported yt-dlp or the database would make a
 * cycle out of that. What lives here is only description; the fetching lives
 * in `searchProviders.ts`.
 *
 * Adding a provider is meant to be this file plus one search function. If
 * anything else has to change to make a third one work, the seam is in the
 * wrong place.
 */

export interface ProviderCapabilities {
  /**
   * Whether the library can hold this provider's videos.
   *
   * False means a card must not offer to download, queue or mark watched: the
   * ids of a provider with no rows here would land in YouTube's own endpoints.
   */
  library: boolean;
  /** Whether one of this provider's channels has a page in this app. */
  channelPages: boolean;
}

export interface SearchProviderDescription {
  id: string;
  label: string;
  /** The hosts it serves thumbnails from. The image proxy trusts these and nothing else. */
  thumbnailHosts: readonly string[];
  capabilities: ProviderCapabilities;
  /** Where a card of this provider leads; `:id` is the video id. */
  watchPath: string;
  /** Where one of its channels leads, or null when it has no page. */
  channelPath: string | null;
}

export const SEARCH_PROVIDERS: readonly SearchProviderDescription[] = [
  {
    id: "youtube",
    label: "YouTube",
    // dearrow-thumb serves replacement frames for YouTube videos: it is not
    // Google's, but every image it answers for is a YouTube one.
    thumbnailHosts: ["ytimg.com", "ggpht.com", "googleusercontent.com", "youtube.com", "dearrow-thumb.ajay.app"],
    capabilities: { library: true, channelPages: true },
    watchPath: "/watch/:id",
    channelPath: "/channel/:id",
  },
  {
    id: "dailymotion",
    label: "Dailymotion",
    thumbnailHosts: ["dmcdn.net"],
    // Nothing of Dailymotion's is written to the database while this is an
    // experiment, so no card of theirs may offer an action that needs a row.
    capabilities: { library: false, channelPages: true },
    watchPath: "/dailymotion/video/:id",
    channelPath: "/dailymotion/channel/:id",
  },
];

export function searchProvider(id: string): SearchProviderDescription | null {
  return SEARCH_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

/** Every host any provider serves images from, for the one proxy that fetches them. */
export function providerThumbnailHosts(): readonly string[] {
  return SEARCH_PROVIDERS.flatMap((provider) => [...provider.thumbnailHosts]);
}

/** The ids asked for, kept to the ones that exist. An empty ask means all of them. */
export function requestedProviders(sources: string | null | undefined): SearchProviderDescription[] {
  const asked = (sources ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!asked.length) return [...SEARCH_PROVIDERS];
  return SEARCH_PROVIDERS.filter((provider) => asked.includes(provider.id));
}
