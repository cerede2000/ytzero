import { useCallback, useEffect, useRef, useState } from "react";
import "./FeedPage.css";
import { emit, subscribe } from "../events";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Clock, Eye, Inbox, Plus, RefreshCw, Upload } from "lucide-react";
import { isShort } from "../shortVideos";
import { api, type Bucket, type Channel, type Tag, type Video } from "../api";
import { useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { img } from "../img";
import ChildTimeRequestBanner from "../components/ChildTimeRequestBanner";
import EmptyArt from "../components/illustrations/EmptyArt";
import TagFilterBar from "../components/TagFilterBar";
import VideoCard, { type CardFeedback } from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { GRID_SIZES, persistGridSize, readGridSize, type GridSize } from "../gridSize";
import { Button, ButtonLink, Divider, EmptyState, IconButton, RevealRegion } from "../components/ui";
import { parseAppTimestamp } from "../dateTime";
import type { PlaybackQueueContext, PlayVideo } from "../playbackQueue";
import { filterChannelsByTags } from "./feedChannelFilter";
import { videoFromDailymotion } from "../dailymotionCards";
import { mergeByRank, providerPath, type SearchProviderDescription } from "../searchProviderTypes";

type AvatarChannel = Channel & { watch_count?: number; is_live?: number };
type FeedSort = "published" | "arrival";

function FeedOnboarding() {
  const { t } = useI18n();
  return (
    <section className="feed-onboarding">
      <div className="feed-onboarding-icon"><Inbox /></div>
      <div className="feed-onboarding-copy">
        <span className="feed-onboarding-eyebrow">YT Zero</span>
        <h1>{t("feedOnboardingTitle")}</h1>
        <p>{t("feedOnboardingDescription")}</p>
      </div>
      <div className="feed-onboarding-actions">
        <ButtonLink variant="primary" to="/subscriptions" leadingIcon={<Plus size={16} />}>{t("feedOnboardingAddChannels")}</ButtonLink>
        <ButtonLink to="/import" leadingIcon={<Upload size={16} />}>{t("feedOnboardingImportTakeout")}</ButtonLink>
      </div>
      <div className="feed-onboarding-steps" aria-label={t("feedOnboardingHowItWorks")}>
        <div><span className="feed-onboarding-step-number">1</span><p>{t("feedOnboardingStepOne")}</p></div>
        <ArrowRight aria-hidden="true" />
        <div><span className="feed-onboarding-step-number">2</span><p>{t("feedOnboardingStepTwo")}</p></div>
        <ArrowRight aria-hidden="true" />
        <div><span className="feed-onboarding-step-number">3</span><p>{t("feedOnboardingStepThree")}</p></div>
      </div>
    </section>
  );
}

function ChannelAvatarRow({ selectedTags }: { selectedTags: number[] }) {
  const { t } = useI18n();
  const [channels, setChannels] = useState<AvatarChannel[]>([]);
  const scroll = useHScroll();

  useEffect(() => {
    let active = true;
    const loadChannels = async () => {
      const next = selectedTags.length === 0
        ? (await api.topChannels()).channels
        : filterChannelsByTags((await api.channels()).channels, selectedTags);
      if (active) setChannels(next);
    };
    void loadChannels().catch(() => {});
    const unsubscribe = subscribe("channels-changed", () => { void loadChannels().catch(() => {}); });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [selectedTags]);

  if (channels.length === 0) return null;

  return (
    <div className={`h-scroll-wrap channel-avatar-section${scroll.shadowLeft ? " shadow-left" : ""}${scroll.shadowRight ? " shadow-right" : ""}`}>
      <div className="channel-avatar-row" ref={scroll.ref}>
        {channels.map((ch) => (
          <Link key={ch.channel_id} to={`/channel/${ch.channel_id}`} className="channel-avatar-item">
            <div className="channel-avatar-wrap">
              {ch.thumbnail ? (
                <img className="channel-avatar-img" src={img(ch.thumbnail)} alt="" />
              ) : (
                <div className="channel-avatar-img channel-avatar-placeholder" />
              )}
              {ch.is_live === 1 && <span className="channel-avatar-live">{t("liveBadge")}</span>}
            </div>
            <span className="channel-avatar-name">{ch.title}</span>
            {ch.subscriber_count && (
              <span className="channel-avatar-subs">{ch.subscriber_count}</span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

const BUCKET_ORDER: Bucket[] = ["today", "tonight", "tomorrow", "tomorrow_evening", "weekend"];

function useHScroll() {
  const [shadowLeft, setShadowLeft] = useState(false);
  const [shadowRight, setShadowRight] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const ref = useCallback((el: HTMLDivElement | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!el) return;
    const update = () => {
      setShadowLeft(el.scrollLeft > 4);
      setShadowRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: false });
    cleanupRef.current = () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  return { ref, shadowLeft, shadowRight };
}

export default function FeedPage({
  onPlay,
  showToast,
  feedSort,
  showTopChannels,
}: {
  onPlay: PlayVideo;
  showToast: (m: string) => void;
  feedSort: FeedSort;
  showTopChannels: boolean;
}) {
  const { t } = useI18n();
  useDocumentTitle();
  const [videos, setVideos] = useState<Video[]>([]);
  const [queued, setQueued] = useState<Video[]>([]);
  const navigate = useNavigate();
  const [inProgress, setInProgress] = useState<Video[]>([]);
  /*
   * Dailymotion's own, kept beside rather than inside.
   *
   * They have no row in the library, so they cannot come from the query that
   * builds the shelf; what they do have is a position under this reader's
   * name, which is the whole of what a shelf of things to carry on with
   * needs. Held apart here, removing the experiment is removing this state
   * and the merge below.
   */
  const [dailymotionInProgress, setDailymotionInProgress] = useState<Video[]>([]);
  const [dailymotionProvider, setDailymotionProvider] = useState<SearchProviderDescription | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<number[]>(() => {
    try { return JSON.parse(sessionStorage.getItem("feedTags") ?? "[]"); } catch { return []; }
  });
  const [showAll, setShowAll] = useState(() => sessionStorage.getItem("feedShowAll") === "1");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const [gridSize, setGridSize] = useState<GridSize>(readGridSize);
  const [inProgressExpanded, setInProgressExpanded] = useState(false);
  const [queuedExpanded, setQueuedExpanded] = useState(false);
  const [hasSubscriptions, setHasSubscriptions] = useState<boolean | null>(null);
  const [subscriptionStateLoading, setSubscriptionStateLoading] = useState(true);
  // Gates the full "start from scratch" walkthrough — separate from
  // hasSubscriptions so a profile with nothing followed yet, on an instance
  // that already has channels/videos (another profile, an import), gets a
  // lighter nudge instead of being told to start from zero.
  const [instanceHasData, setInstanceHasData] = useState<boolean | null>(null);
  const [enteringFeedVideoId, setEnteringFeedVideoId] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const enteringFeedTimerRef = useRef<number | null>(null);
  const inProgressScroll = useHScroll();
  const queuedScroll = useHScroll();

  // Only the plain chronological feed grid gets a feed-context marker — the
  // queued/in-progress rows are different lists, so "next" there wouldn't
  // match what /feed/adjacent (and thus the autoplay setting) expects.
  const handleFeedPlay = useCallback((v: Video) => onPlay(v, {
    version: 1,
    kind: "feed",
    tags: selectedTags,
    showAll,
    sort: feedSort,
  }), [onPlay, selectedTags, showAll, feedSort]);
  const hScrollWrapRef = useRef<HTMLDivElement>(null);
  const [hCardWidth, setHCardWidth] = useState(220);
  const [hCardMin, setHCardMin] = useState(248);

  useEffect(() => {
    const read = () => setHCardMin(Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue("--video-card-min"), 10) || 248);
    read();
    const unsubscribeChanged = subscribe("video-card-size-changed", read);
    const unsubscribeApplied = subscribe("video-card-size-applied", read);
    return () => { unsubscribeChanged(); unsubscribeApplied(); };
  }, []);

  useEffect(() => {
    const el = hScrollWrapRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const min = hCardMin;
      const gap = 12;
      // Match CSS Grid's auto-fill calculation: gaps consume width too.
      // Without them, a 220 px preference could squeeze in one extra card.
      const cols = Math.max(1, Math.floor((w + gap) / (min + gap)));
      setHCardWidth(Math.max(min, Math.floor((w - (cols - 1) * gap) / cols)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hCardMin]);

  useEffect(() => () => {
    if (enteringFeedTimerRef.current !== null) window.clearTimeout(enteringFeedTimerRef.current);
  }, []);

  const load = useCallback(async (requestedPage = page) => {
    if (requestedPage === 0) setLoading(true);
    else setLoadingMore(true);
    try {
      const feed = await api.feed({ tags: selectedTags, page: requestedPage, show_all: showAll, sort: feedSort });
      setVideos((prev) => (requestedPage === 0 ? feed.videos : [...prev, ...feed.videos]));
      setHasMore(feed.videos.length === 40);
      setLoading(false);
    } finally {
      setLoadingMore(false);
    }
  }, [selectedTags, page, showAll, feedSort]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const loadTags = useCallback(() =>
    api.tags().then((r) => setTags(r.tags)).catch(console.error), []);

  const loadQueued = useCallback(() =>
    api.watchlist().then((r) => setQueued(r.videos)).catch(console.error), []);

  const loadInProgress = useCallback(() =>
    api.inProgress().then((r) => setInProgress(r.videos.filter((video) => !isShort(video)))).catch(console.error), []);

  const loadDailymotionInProgress = useCallback(async () => {
    try {
      const [{ providers }, held] = await Promise.all([api.searchProviders(), api.dailymotionContinue()]);
      const provider = providers.find((candidate) => candidate.id === "dailymotion") ?? null;
      setDailymotionProvider(provider);
      // A profile that may not be offered the provider is not offered its
      // shelf either: the gate is the registry's, not this page's to repeat.
      const now = Date.now();
      setDailymotionInProgress(provider
        ? held.videos.map((video) => videoFromDailymotion(video, held.progress[video.videoId] ?? null, now))
        : []);
    } catch {
      setDailymotionInProgress([]);
    }
  }, []);

  useEffect(() => {
    loadTags();
    loadQueued();
    loadInProgress();
    void loadDailymotionInProgress();
  }, [loadTags, loadQueued, loadInProgress, loadDailymotionInProgress]);

  const loadSubscriptionState = useCallback(() => {
    setSubscriptionStateLoading(true);
    return api.channels().then((r) => {
      setHasSubscriptions(r.channels.some((channel) => channel.followed !== 0));
      setInstanceHasData(r.instance_has_data);
      setSubscriptionStateLoading(false);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    loadSubscriptionState();
    return subscribe("channels-changed", loadSubscriptionState);
  }, [loadSubscriptionState]);

  useEffect(() => subscribe("tags-changed", loadTags), [loadTags]);
  useEffect(() => subscribe("queue-changed", loadQueued), [loadQueued]);

  // Infinite scroll
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasMore) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setPage((p) => p + 1); },
      { rootMargin: "200px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, videos]);

  const changeGridSize = (size: GridSize) => {
    setGridSize(size);
    persistGridSize(size);
  };

  const toggleTag = (id: number) => {
    setLoading(true);
    setPage(0);
    setSelectedTags((s) => {
      const next = s.includes(id) ? s.filter((t) => t !== id) : [...s, id];
      sessionStorage.setItem("feedTags", JSON.stringify(next));
      return next;
    });
  };

  const toggleShowAll = () => {
    setLoading(true);
    setPage(0);
    setShowAll((s) => {
      const next = !s;
      if (next) sessionStorage.setItem("feedShowAll", "1");
      else sessionStorage.removeItem("feedShowAll");
      return next;
    });
  };

  const clearTags = () => {
    setLoading(true);
    setPage(0);
    setSelectedTags([]);
    sessionStorage.removeItem("feedTags");
  };

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    emit("feed-refresh-started");
    setRefreshing(true);
    try {
      const r = await api.refresh();
      showToast(t("refreshed", { channels: r.channels, added: r.added }));
      setLoading(true);
      setPage(0);
      await load(0);
    } catch (e) {
      showToast(`${t("refreshError")} ${e instanceof Error ? e.message : e}`);
    } finally {
      refreshingRef.current = false;
      emit("feed-refresh-finished");
      setRefreshing(false);
    }
  }, [load, showToast, t]);

  const reloadView = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    emit("feed-refresh-started");
    setLoading(true);
    setPage(0);
    try {
      await Promise.all([
        load(0),
        loadTags(),
        loadQueued(),
        loadInProgress(),
        loadSubscriptionState(),
      ]);
    } catch (error) {
      console.error(error);
    } finally {
      refreshingRef.current = false;
      emit("feed-refresh-finished");
    }
  }, [load, loadTags, loadQueued, loadInProgress, loadSubscriptionState]);

  useEffect(() => subscribe("feed-view-reload-requested", () => { void reloadView(); }), [reloadView]);

  const reload = () => {
    setLoading(true);
    setPage(0);
    load(0).catch(console.error);
    loadQueued();
    loadInProgress();
  };

  const removeFromFeed = (videoId?: string) => {
    if (videoId) setVideos((current) => current.filter((v) => v.video_id !== videoId));
    loadQueued();
    loadInProgress();
  };

  const handleInProgressChanged = (videoId?: string, feedback?: CardFeedback) => {
    if (!videoId) return;
    loadQueued();

    if (feedback !== "unwatched") {
      setVideos((current) => current.filter((video) => video.video_id !== videoId));
      loadInProgress();
      return;
    }

    api.inProgress().then((result) => {
      setVideos((current) => current.map((video) => video.video_id === videoId
        ? { ...video, watched: null, watch_position: null, watch_duration: null, status: "inbox" }
        : video));
      setEnteringFeedVideoId(videoId);
      setInProgress(result.videos.filter((video) => !isShort(video)));
      if (enteringFeedTimerRef.current !== null) window.clearTimeout(enteringFeedTimerRef.current);
      enteringFeedTimerRef.current = window.setTimeout(() => setEnteringFeedVideoId(null), 800);
    }).catch(console.error);
  };

  // Time-based queued sections — only show videos that have unlocked.
  const now = new Date();
  const dueQueuedVideos = queued
    .filter((v) => v.bucket && (!v.show_from || parseAppTimestamp(v.show_from) <= now))
    .sort((a, b) => {
      const bucketDiff = BUCKET_ORDER.indexOf(a.bucket!) - BUCKET_ORDER.indexOf(b.bucket!);
      if (bucketDiff !== 0) return bucketDiff;
      return parseAppTimestamp(a.show_from ?? 0).getTime() - parseAppTimestamp(b.show_from ?? 0).getTime();
    });
  /*
   * One shelf, two origins, merged by rank.
   *
   * Each list arrives in its own order of last watched, and there is no shared
   * instant to sort them against — the library's shelf does not carry one out
   * to the page. Alternating keeps both orders intact and gives neither the
   * head of the shelf for being somebody's.
   */
  const resumable = mergeByRank([
    inProgress.map((video) => ({ video, provider: null as SearchProviderDescription | null })),
    dailymotionInProgress.map((video) => ({ video, provider: dailymotionProvider })),
  ]);
  const inProgressIds = new Set(inProgress.map((video) => video.video_id));
  const feedVideos = videos.filter((video) => !inProgressIds.has(video.video_id));
  const showQueuedSection = dueQueuedVideos.length > 0 && selectedTags.length === 0;
  const showFeedPreludeDivider = resumable.length > 0 || showQueuedSection;
  const inProgressQueue: PlaybackQueueContext = { version: 1, kind: "in-progress" };
  const dueQueuedQueue: PlaybackQueueContext = { version: 1, kind: "watchlist", sort: "schedule", dueOnly: true };

  if (!loading && !subscriptionStateLoading && instanceHasData === false) {
    return (
      <>
        <ChildTimeRequestBanner />
        <FeedOnboarding />
      </>
    );
  }

  return (
    <>
      <ChildTimeRequestBanner />
      <div className="toolbar" ref={hScrollWrapRef}>
        <TagFilterBar
          tags={tags.filter((t) => !t.hidden_from_filters)}
          selected={selectedTags}
          onToggle={toggleTag}
          onClearAll={clearTags}
          suffix={
            <button
              className={`chip${showAll ? " active" : ""}`}
              onClick={toggleShowAll}
              title={t("showAll")}
            >
              <Eye size={13} />
              {t("showAll")}
            </button>
          }
        />
        <div className="toolbar-right" style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <IconButton label={t("refresh")} icon={<RefreshCw className={refreshing ? "spin" : undefined} />} onClick={refresh} disabled={refreshing} />
        </div>
      </div>

      {showTopChannels && <ChannelAvatarRow selectedTags={selectedTags} />}

      <RevealRegion open={resumable.length > 0}>
        <div className="continue-watching-section">
          <div className="time-section-header">
            <Clock size={16} />
            <span>{t("continueWatching")}</span>
          </div>
          <div className={`h-scroll-wrap${inProgressScroll.shadowLeft ? " shadow-left" : ""}${inProgressScroll.shadowRight ? " shadow-right" : ""}`}>
            <div
              id="continue-watching-list"
              className={`h-scroll-row h-scroll-row--${gridSize} mobile-preview-row${inProgressExpanded ? " is-expanded" : ""}`}
              ref={inProgressScroll.ref}
            >
              {resumable.map(({ video: v, provider }) => (
                <div key={`${provider?.id ?? "library"}:${v.video_id}`} className="h-scroll-card" style={{ width: hCardWidth }}>
                  {/*
                    Leaving this shelf is not rejecting the video or claiming to
                    have finished it — the two the card already offers. It is "I
                    am not coming back to this one", which is what a remembered
                    position means and the only thing cleared. It belongs in the
                    card's own actions rather than beside them, where it merely
                    fought the menu for the same corner.
                  */}
                  <VideoCard
                    video={v}
                    provider={provider ?? undefined}
                    readOnly={Boolean(provider)}
                    onPlay={(video) => (provider
                      ? navigate(providerPath(provider.watchPath, video.video_id))
                      : onPlay(video, video.playback_context ?? inProgressQueue))}
                    onChanged={handleInProgressChanged}
                    onRemoveFromContinue={(videoId) => {
                      if (provider) {
                        setDailymotionInProgress((current) => current.filter((video) => video.video_id !== videoId));
                        api.forgetDailymotionProgress(videoId).catch(() => { void loadDailymotionInProgress(); });
                        return;
                      }
                      setInProgress((current) => current.filter((video) => video.video_id !== videoId));
                      api.clearProgress(videoId).catch(() => loadInProgress());
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
          {resumable.length > 3 && (
            <div className="mobile-preview-toggle">
              <Button
                size="sm"
                aria-expanded={inProgressExpanded}
                aria-controls="continue-watching-list"
                onClick={() => setInProgressExpanded((expanded) => !expanded)}
              >
                {t(inProgressExpanded ? "showLess" : "showMore")}
              </Button>
            </div>
          )}
        </div>
      </RevealRegion>

      <RevealRegion open={showQueuedSection}>
        <div className="time-section">
          <div className="time-section-header">
            <Clock size={16} />
            <span>{t("navWatchlist")}</span>
          </div>
          <div className={`h-scroll-wrap${queuedScroll.shadowLeft ? " shadow-left" : ""}${queuedScroll.shadowRight ? " shadow-right" : ""}`}>
            <div
              id="scheduled-feed-list"
              className={`h-scroll-row h-scroll-row--${gridSize} mobile-preview-row${queuedExpanded ? " is-expanded" : ""}`}
              ref={queuedScroll.ref}
            >
              {dueQueuedVideos.map((v) => (
                <div key={v.video_id} className="h-scroll-card" style={{ width: hCardWidth }}>
                  <VideoCard video={v} onPlay={(video) => onPlay(video, dueQueuedQueue)} onChanged={reload} />
                </div>
              ))}
            </div>
          </div>
          {dueQueuedVideos.length > 3 && (
            <div className="mobile-preview-toggle">
              <Button
                size="sm"
                aria-expanded={queuedExpanded}
                aria-controls="scheduled-feed-list"
                onClick={() => setQueuedExpanded((expanded) => !expanded)}
              >
                {t(queuedExpanded ? "showLess" : "showMore")}
              </Button>
            </div>
          )}
        </div>
      </RevealRegion>

      <RevealRegion open={showFeedPreludeDivider}><Divider /></RevealRegion>

      {videos.length === 0 && (loading || (selectedTags.length === 0 && subscriptionStateLoading)) ? (
        <VideoGridSkeleton gridSize={gridSize} />
      ) : videos.length === 0 ? (
        hasSubscriptions === false ? (
          <EmptyState
            art={<EmptyArt scene="noSubscriptions" />}
            title={t("feedEmptyNotFollowingTitle")}
            description={t("feedEmptyNotFollowingDescription")}
            action={<ButtonLink variant="primary" to="/subscriptions" leadingIcon={<Plus size={16} />}>{t("feedOnboardingAddChannels")}</ButtonLink>}
          />
        ) : selectedTags.length > 0 ? (
          <EmptyState
            icon={<Inbox />}
            title={t("feedEmptyNoTagMatchTitle")}
            description={t("feedEmptyNoTagMatchDescription")}
            action={<Button onClick={clearTags}>{t("feedEmptyNoTagMatchAction")}</Button>}
          />
        ) : (
          <EmptyState
            art={<EmptyArt scene="inboxZero" />}
            eyebrow={t("feedEmptyCaughtUpEyebrow")}
            title={t("feedEmptyCaughtUpTitle")}
            description={t("feedEmptyCaughtUpDescription")}
          />
        )
      ) : (
        <>
          <div className={`video-grid video-grid--${gridSize}`}>
            {feedVideos.map((v) => (
              <VideoCard
                key={v.video_id}
                video={v}
                onPlay={handleFeedPlay}
                onChanged={removeFromFeed}
                entering={v.video_id === enteringFeedVideoId}
                showFoundTime={feedSort === "arrival"}
              />
            ))}
          </div>
          {loadingMore && <VideoGridSkeleton count={4} gridSize={gridSize} />}
          {hasMore && !loadingMore && (
            <div className="load-more">
              <Button ref={loadMoreRef} onClick={() => setPage((p) => p + 1)}>{t("loadMore")}</Button>
            </div>
          )}
        </>
      )}

    </>
  );
}
