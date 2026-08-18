import { useCallback, useEffect, useMemo, useState } from "react";
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
import { mergeByRank, providerPath, type SearchProviderDescription } from "../searchProviderTypes";

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
  const [external, setExternal] = useState<Record<string, { results: SearchResult[]; channels: ChannelSearchResult[] }>>({});
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
    if (!q || hideExternalSearch || !active.length) { setExternal({}); return; }
    let cancelled = false;
    setYtLoading(true);
    api.searchExternal(q, active.map((provider) => provider.id))
      .then((answer) => {
        if (cancelled) return;
        setExternal(answer.providers);
        setYtDownloads({ allowed: Boolean(answer.downloads_allowed), enabled: Boolean(answer.downloads_enabled) });
      })
      .catch(() => { if (!cancelled) setExternal({}); })
      .finally(() => { if (!cancelled) setYtLoading(false); });
    return () => { cancelled = true; };
  }, [q, hideExternalSearch, active]);

  // Results become cards without asking the server anything: everything a card
  // shows is already in the answer, and the import an action needs is that
  // action's own cost, not the price of scrolling past twenty videos.
  const ytVideos = useMemo(() => {
    const now = Date.now();
    return mergeByRank(active.map((provider) => (external[provider.id]?.results ?? []).map((result) => ({
      provider,
      video: videoFromSearchResult(result, {
        // A provider the library cannot hold has nothing to download to it.
        downloadsAllowed: provider.capabilities.library && ytDownloads.allowed,
        downloadsEnabled: provider.capabilities.library && ytDownloads.enabled,
        now,
      }),
      inLibrary: result.in_library === 1,
    }))));
  }, [active, external, ytDownloads]);

  const externalChannels = useMemo(() => {
    // A channel already followed here is shown by the library's own section
    // above; offering it again as a stranger is the same row twice. Only a
    // provider whose channels can be followed has rows to be matched against.
    const followed = new Set(localChannels.map((channel) => channel.channel_id));
    return mergeByRank(active.map((provider) => (external[provider.id]?.channels ?? [])
      .filter((channel) => !(provider.capabilities.library && followed.has(channel.channelId)))
      .map((channel) => ({ provider, channel }))));
  }, [active, external, localChannels]);

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
                  provider={provider}
                  // Nothing here may be downloaded, queued or marked watched.
                  readOnly={!provider.capabilities.library}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
