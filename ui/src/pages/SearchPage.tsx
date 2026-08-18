import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./SearchPage.css";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { api, type Channel, type ChannelSearchResult, type SearchResult, type Video } from "../api";
import { useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { img } from "../img";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { EmptyState, RevealList } from "../components/ui";
import { videoFromSearchResult } from "../searchResultVideo";
import { mergeByRank, providerPath, type ExternalSearch, type SearchProviderDescription } from "../searchProviderTypes";

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export default function SearchPage({ onPlay, hideExternalSearch = false }: { onPlay: (video: Video) => void; hideExternalSearch?: boolean }) {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const q = params.get("q")?.trim() ?? "";
  useDocumentTitle(q || t("searchTitle"));
  const [videos, setVideos] = useState<Video[]>([]);
  const [localChannels, setLocalChannels] = useState<Channel[]>([]);
  const [providers, setProviders] = useState<SearchProviderDescription[]>([]);
  /*
   * Windows, kept per provider rather than per request.
   *
   * Asked for together in one request, the page waited on the slowest: nothing
   * at all for three seconds while Dailymotion had answered in one. Asked
   * separately and at once, each paints as it lands, and a provider that is
   * slow or down no longer costs the others their results.
   *
   * They stay in windows rather than one merged list. A window is balanced
   * inside itself; merged across the whole accumulation instead, a provider
   * that ran out early would leave the rest of the page to whoever still had
   * answers, and the alternation would break halfway down.
   */
  const [windows, setWindows] = useState<Record<string, ExternalSearch["providers"][string][]>>({});
  const [loadingMore, setLoadingMore] = useState(false);
  const moreBelow = useRef(false);
  const [ytDownloads, setYtDownloads] = useState({ allowed: false, enabled: false });
  const [localLoading, setLocalLoading] = useState(false);
  const [localLoadingMore, setLocalLoadingMore] = useState(false);
  const [localResultsExpanded, setLocalResultsExpanded] = useState(false);
  const [ytLoading, setYtLoading] = useState(false);
  const navigate = useNavigate();

  /*
   * Which provider the reader is looking at, kept in the address.
   *
   * A filter held in state alone is lost on reload and cannot be sent to
   * anybody, and this is a page whose whole purpose is to be linked to. An
   * unknown or absent value means all of them, which is also what a link
   * written before a provider existed should keep meaning.
   */
  const chosen = params.get("source") ?? "";
  const active = useMemo(
    () => (providers.some((provider) => provider.id === chosen) ? providers.filter((provider) => provider.id === chosen) : providers),
    [providers, chosen],
  );

  useEffect(() => {
    if (hideExternalSearch) { setProviders([]); return; }
    let cancelled = false;
    api.searchProviders()
      .then((answer) => { if (!cancelled) setProviders(answer.providers); })
      .catch(() => { if (!cancelled) setProviders([]); });
    return () => { cancelled = true; };
  }, [hideExternalSearch]);

  const reloadLocalVideos = useCallback(() => {
    if (!q) return;
    api.feed({ q, limit: localResultsExpanded ? 100 : 8, status: "all" })
      .then((feed) => setVideos(feed.videos))
      .catch(() => setVideos([]));
  }, [localResultsExpanded, q]);

  const toggleLocalResults = () => {
    if (localResultsExpanded) { setLocalResultsExpanded(false); return; }
    // Expanding may reveal more than the initial page held, so pull the rest.
    setLocalLoadingMore(true);
    api.feed({ q, limit: 100, status: "all" })
      .then((feed) => {
        setVideos(feed.videos);
        setLocalResultsExpanded(true);
      })
      .catch(() => {})
      .finally(() => setLocalLoadingMore(false));
  };

  useEffect(() => {
    if (!q) { setVideos([]); setLocalChannels([]); return; }
    let cancelled = false;
    setLocalResultsExpanded(false);
    setLocalLoading(true);
    Promise.all([
      api.feed({ q, limit: 8, status: "all" }),
      api.channels(),
    ]).then(([feed, channels]) => {
      if (cancelled) return;
      const needle = normalizeSearchText(q);
      setVideos(feed.videos);
      setLocalChannels(channels.channels.filter((channel) =>
        normalizeSearchText(channel.title).includes(needle)
        || normalizeSearchText(channel.channel_id).includes(needle)
        || normalizeSearchText(channel.handle ?? "").includes(needle)
        || normalizeSearchText(channel.description ?? "").includes(needle)));
    }).catch(() => {
      if (!cancelled) { setVideos([]); setLocalChannels([]); }
    }).finally(() => { if (!cancelled) setLocalLoading(false); });
    return () => { cancelled = true; };
  }, [q]);

  useEffect(() => {
    if (!q || hideExternalSearch || !active.length) { setWindows({}); return; }
    let cancelled = false;
    setYtLoading(true);
    setWindows({});
    moreBelow.current = false;
    let outstanding = active.length;
    for (const provider of active) {
      api.searchExternal(q, [provider.id])
        .then((answer) => {
          if (cancelled) return;
          const found = answer.providers[provider.id];
          if (found) {
            setWindows((held) => ({ ...held, [provider.id]: [found] }));
            if (found.more) moreBelow.current = true;
            // The skeleton goes on the first answer, not the last: the whole
            // point is that the page stops waiting on the slowest provider.
            if (found.results.length) setYtLoading(false);
          }
          setYtDownloads({ allowed: Boolean(answer.downloads_allowed), enabled: Boolean(answer.downloads_enabled) });
        })
        .catch(() => {})
        // And goes anyway once everybody has spoken, so a search that finds
        // nothing shows that rather than a skeleton for ever.
        .finally(() => { if (!cancelled && --outstanding <= 0) setYtLoading(false); });
    }
    return () => { cancelled = true; };
  }, [q, hideExternalSearch, active]);

  /*
   * The next window, asked for when the foot of the list comes into view.
   *
   * Guarded on the ref rather than on state so that two intersections in the
   * same frame cannot both start a request: the flag is down before either
   * has re-rendered.
   */
  const loadMore = useCallback(async () => {
    if (!moreBelow.current || loadingMore || !q || !active.length) return;
    // Only the providers that said there was more, and each for its own next
    // window: they run out at different depths, and one that has finished must
    // not be asked again on every scroll.
    const asking = active.filter((provider) => {
      const held = windows[provider.id];
      return Boolean(held?.length && held[held.length - 1].more);
    });
    if (!asking.length) { moreBelow.current = false; return; }
    moreBelow.current = false;
    setLoadingMore(true);
    const answers = await Promise.all(asking.map((provider) =>
      api.searchExternal(q, [provider.id], (windows[provider.id]?.length ?? 0) + 1)
        .then((answer) => ({ provider, found: answer.providers[provider.id] }))
        // A window that fails is not the end of the list; the next scroll retries.
        .catch(() => { moreBelow.current = true; return null; })));
    setWindows((held) => {
      const next = { ...held };
      for (const answer of answers) {
        if (!answer?.found?.results.length) continue;
        next[answer.provider.id] = [...(held[answer.provider.id] ?? []), answer.found];
        if (answer.found.more) moreBelow.current = true;
      }
      return next;
    });
    setLoadingMore(false);
  }, [q, active, windows, loadingMore]);

  /*
   * Held in state, not in a ref.
   *
   * The foot is only drawn once results have arrived, and an effect reading a
   * ref runs before that: it found nothing, and nothing changed afterwards
   * that would have made it look again. Kept in state, the node appearing is
   * itself what re-runs the effect.
   */
  const [foot, setFoot] = useState<HTMLDivElement | null>(null);

  /*
   * Two ways of noticing the foot of the list, for one load.
   *
   * The observer is the right instrument and the cheap one. It is also frozen
   * by a browser in a background or throttled tab, where it simply never
   * reports — so a scroll of the page checks the distance itself as a floor.
   * Both go through `loadMore`, which lowers its own flag before fetching, so
   * the pair cannot ask twice for the same window.
   */
  useEffect(() => {
    const node = foot;
    if (!node) return;
    const watcher = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "600px" });
    watcher.observe(node);
    const onScroll = () => {
      // A ref read, and nothing else, once the list has nothing left to fetch.
      if (!moreBelow.current) return;
      if (node.getBoundingClientRect().top - window.innerHeight < 600) void loadMore();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      watcher.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [foot, loadMore]);

  // Results become cards without asking the server anything: everything a card
  // shows is already in the answer, and the import an action needs is that
  // action's own cost, not the price of scrolling past twenty videos.
  const ytVideos = useMemo(() => {
    const now = Date.now();
    const card = (provider: SearchProviderDescription, result: SearchResult) => ({
      provider,
      video: videoFromSearchResult(result, {
        // A provider the library cannot hold has nothing to download to it.
        downloadsAllowed: provider.capabilities.library && ytDownloads.allowed,
        downloadsEnabled: provider.capabilities.library && ytDownloads.enabled,
        now,
      }),
      inLibrary: result.in_library === 1,
    });

    // Window by window, so each stays balanced inside itself even when the
    // providers filling them ran out at different depths.
    const depth = Math.max(0, ...active.map((provider) => windows[provider.id]?.length ?? 0));
    const merged: ReturnType<typeof card>[] = [];
    for (let rank = 0; rank < depth; rank++) {
      merged.push(...mergeByRank(active.map((provider) =>
        (windows[provider.id]?.[rank]?.results ?? []).map((result) => card(provider, result)))));
    }

    // Windows overlap when a provider's own paging repeats an entry.
    const seen = new Set<string>();
    return merged.filter(({ provider, video }) => {
      const key = `${provider.id}:${video.video_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [active, windows, ytDownloads]);

  const externalChannels = useMemo(() => {
    // A channel already followed here is shown by the library's own section
    // above; offering it again as a stranger is the same row twice. Only a
    // provider whose channels can be followed has rows to be matched against.
    const followed = new Set(localChannels.map((channel) => channel.channel_id));
    return mergeByRank(active.map((provider) => (windows[provider.id]?.[0]?.channels ?? [])
      .filter((channel) => !(provider.capabilities.library && followed.has(channel.channelId)))
      .map((channel) => ({ provider, channel }))));
  }, [active, windows, localChannels]);

  const chooseSource = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set("source", id); else next.delete("source");
    navigate({ search: next.toString() }, { replace: true });
  };

  if (!q) {
    return <EmptyState icon={<Search />} title={t("searchPlaceholder")} />;
  }

  return (
    <div className="search-page">
      <p className="search-info">{t("searchResultsFor")} <b>{q}</b></p>

      {(localLoading || localChannels.length > 0 || videos.length > 0) && (
        <section className="search-results-section search-results-section--local">
          {(localLoading || localChannels.length > 0) && <>
          <div className="search-results-header">{t("localSearchChannels")}</div>
          {localLoading ? <div className="search-channel-loading" /> : (
            <RevealList
              key={q}
              items={localChannels}
              listClassName="yt-results-list yt-channel-results-list"
              showMore={t("showMore")}
              showLess={t("showLess")}
              renderRow={(channel) => (
                <Link key={channel.channel_id} className="yt-result-row" to={`/channel/${channel.channel_id}`}>
                  {channel.thumbnail ? <img className="yt-search-channel-avatar" src={img(channel.thumbnail)} alt="" loading="lazy" /> : <div className="yt-search-channel-avatar yt-search-channel-avatar--fallback">{channel.title.charAt(0).toUpperCase()}</div>}
                  <div className="yt-result-info">
                    <div className="yt-result-title">{channel.title}</div>
                    <div className="yt-result-meta">{[channel.subscriber_count && `${channel.subscriber_count} ${t("subscribers")}`, ...channel.tags.map((tag) => tag.name)].filter(Boolean).join(" · ")}</div>
                  </div>
                </Link>
              )}
            />
          )}
          </>}

          {(localLoading || videos.length > 0) && <div className="search-local-videos-section">
          <div className="search-results-header">{t("localSearchVideos")}</div>
          {localLoading ? <VideoGridSkeleton count={3} gridSize="sm" /> : (
            <RevealList
              items={videos}
              listClassName="search-local-video-list"
              showMore={t("showMore")}
              showLess={t("showLess")}
              expanded={localResultsExpanded}
              onToggle={toggleLocalResults}
              busy={localLoadingMore}
              renderRow={(video) => <VideoCard key={video.video_id} video={video} onPlay={onPlay} onChanged={reloadLocalVideos} searchResultLayout />}
            />
          )}
          </div>}
        </section>
      )}

      {!hideExternalSearch && providers.length > 1 && (
        <div className="search-source-filter" role="group" aria-label={t("searchEverySource")}>
          <button type="button" className={`search-source-chip${chosen ? "" : " is-active"}`}
            aria-pressed={!chosen} onClick={() => chooseSource("")}>{t("searchEverySource")}</button>
          {providers.map((provider) => (
            <button key={provider.id} type="button"
              className={`search-source-chip${chosen === provider.id ? " is-active" : ""}`}
              data-source={provider.id}
              aria-pressed={chosen === provider.id}
              onClick={() => chooseSource(provider.id)}>{provider.label}</button>
          ))}
        </div>
      )}

      {!hideExternalSearch && (
        <section className="search-results-section">
          {externalChannels.length > 0 && (
            <>
              <div className="search-results-header">{t("channels")}</div>
              <RevealList
                key={q}
                items={externalChannels}
                listClassName="yt-results-list yt-channel-results-list"
                showMore={t("showMore")}
                showLess={t("showLess")}
                renderRow={({ provider, channel }) => (
                  <Link key={`${provider.id}:${channel.channelId}`} className="yt-result-row"
                    to={providerPath(provider.channelPath ?? "/channel/:id", channel.channelId)}>
                    {channel.thumbnail ? <img className="yt-search-channel-avatar" src={img(channel.thumbnail)} alt="" loading="lazy" /> : <div className="yt-search-channel-avatar" />}
                    <div className="yt-result-info">
                      <div className="yt-result-title">{channel.title}</div>
                      <div className="yt-result-meta">{[provider.id === "youtube" ? channel.handle : provider.label, channel.subscriberCount && `${channel.subscriberCount} ${t("subscribers")}`, channel.videoCount].filter(Boolean).join(" · ")}</div>
                    </div>
                  </Link>
                )}
              />
            </>
          )}
          <div className="search-results-header">
            {active.length === 1 ? active[0].label : t("searchExternalResults")}
          </div>
          {ytLoading ? <VideoGridSkeleton count={4} gridSize="sm" /> : ytVideos.length === 0 ? null : (
            <div className="search-local-video-list">
              {ytVideos.map(({ provider, video, inLibrary }) => (
                <VideoCard
                  key={`${provider.id}:${video.video_id}`}
                  video={video}
                  /*
                   * A provider with no rows here is played by going to its own
                   * page: the queue and the player read the library, and this
                   * video is not in it.
                   */
                  onPlay={provider.capabilities.library ? onPlay : () => navigate(providerPath(provider.watchPath, video.video_id))}
                  onChanged={reloadLocalVideos}
                  searchResultLayout
                  processing={false}
                  inLibrary={inLibrary}
                  // What may be done with it is the provider's business, and
                  // the card reads it from there rather than being told twice.
                  provider={provider}
                />
              ))}
            </div>
          )}
          {/* The foot of the list, watched so the next window arrives before it is reached. */}
          {!ytLoading && ytVideos.length > 0 && <div ref={setFoot} className="search-more-sentinel" aria-hidden="true" />}
          {loadingMore && <VideoGridSkeleton count={2} gridSize="sm" />}
        </section>
      )}
    </div>
  );
}
