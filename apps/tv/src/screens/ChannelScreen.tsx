import { TvGridList, type TvGridListRef } from "../components/TvGridList";
import { usePaginationFocus } from "../usePaginationFocus";
import { TvEmptyState } from "../components/TvEmptyState";
import { TvPageBackButton } from "../components/TvPageBackButton";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TVFocusGuideView, Image, StyleSheet, Text, View, type FocusDestination, type ListRenderItemInfo } from "react-native";
import type { YtZeroApi } from "../api";
import { channelContentTabs, splitChannelVideos, type ChannelContentTab } from "../channelContent";
import { TvButton } from "../components/TvButton";
import { TvLoadingMark } from "../components/TvLoadingMark";
import { TvShortCard } from "../components/TvShortCard";
import { TvTabBar } from "../components/TvTabBar";
import { TvVideoShelf } from "../components/TvVideoShelf";
import type { VideoActionOptions } from "../components/TvVideoActionMenu";
import { VideoCard } from "../components/VideoCard";
import { sessionContext, type OpenVideo } from "../playbackQueue";
import { focusWhenReady, useContentFocusAllowed } from "../focus";
import type { Translate } from "../i18n";
import { tvGridListPerformance } from "../listPerformance";
import { colors, typography, screenPadding } from "../theme";
import type { Channel, ChannelAbout, Language, Video } from "../types";
import { useChannelSync } from "../useChannelSync";
import { imageSourceWithHeaders } from "../imageSource";

type Props = {
  api: YtZeroApi;
  videoUpdate: Video | null;
  channelId: string;
  focusRequest: number;
  language: Language;
  onBack: () => void;
  onOpen: OpenVideo;
  onPrimaryFocusTarget: (target: View | null) => void;
  onVideoLongPress: (video: Video, onChange: (updated: Video) => void, options?: VideoActionOptions) => void;
  profileFocusTarget: FocusDestination;
  shortsEnabled: boolean;
  t: Translate;
  viewportHeight: number;
  viewportWidth: number;
};
const videoKey = (video: Video) => video.video_id;

export function ChannelScreen({ api, videoUpdate, channelId, focusRequest, language, onBack, onOpen, onPrimaryFocusTarget, onVideoLongPress, profileFocusTarget, shortsEnabled, t, viewportHeight: height, viewportWidth: width }: Props) {
  const contentFocusAllowed = useContentFocusAllowed();
  const columns = width >= 1400 ? 4 : 3;
  const contentWidth = Math.max(720, width - (screenPadding + 20) * 2);
  const cardWidth = Math.floor((contentWidth - (columns - 1) * 28) / columns);
  const shelfCardWidth = Math.min(380, Math.floor((contentWidth - 3 * 26) / 4));
  const [about, setAbout] = useState<ChannelAbout | null>(null);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [liveVideos, setLiveVideos] = useState<Video[]>([]);
  const [tab, setTab] = useState<ChannelContentTab>("videos");
  const [page, setPage] = useState(0);
  const loadedPage = useRef(page);
  loadedPage.current = page;
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState(false);
  const [error, setError] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState(false);
  const [backTarget, setBackTarget] = useState<View | null>(null);
  const [followTarget, setFollowTarget] = useState<View | null>(null);
  const [firstLiveTarget, setFirstLiveTarget] = useState<View | null>(null);
  const [firstTabTarget, setFirstTabTarget] = useState<View | null>(null);
  const [firstVideoTarget, setFirstVideoTarget] = useState<View | null>(null);
  const listRef = useRef<TvGridListRef<Video>>(null);
  const retryRef = useRef<View>(null);
  const emptyRef = useRef<View>(null);
  const requestId = useRef(0);
  const handledFocusRequest = useRef<number | null>(null);

  const load = useCallback(async (background = false) => {
    const currentRequest = ++requestId.current;
    if (!background) setLoading(true);
    setLoadingMore(false);
    setPageError(false);
    setError(false);
    setFollowError(false);
    if (!background) {
      setFirstLiveTarget(null);
      setFirstTabTarget(null);
      setFirstVideoTarget(null);
    }
    const [channelResult, aboutResult, videosResult, liveResult] = await Promise.allSettled([
      api.channel(channelId),
      api.channelAbout(channelId),
      Promise.all(Array.from({ length: background ? loadedPage.current + 1 : 1 }, (_, index) => api.channelVideos(channelId, index))).then((pages) => {
        const last = pages[pages.length - 1]!;
        return { ...last, hasMore: last.videos.length === last.limit, videos: [...new Map(pages.flatMap((page) => page.videos).map((video) => [video.video_id, video])).values()] };
      }),
      api.channelLive(channelId),
    ]);
    if (currentRequest !== requestId.current) return;
    if (background && (channelResult.status === "rejected" || videosResult.status === "rejected" || liveResult.status === "rejected")) {
      throw new Error("channel refresh failed");
    }
    if (channelResult.status === "rejected" && aboutResult.status === "rejected") {
      setError(true);
      setLoading(false);
      return;
    }
    const nextAbout = aboutResult.status === "fulfilled" ? aboutResult.value : null;
    const nextChannel = channelResult.status === "fulfilled" ? channelResult.value.channel : null;
    if (!background || nextAbout) setAbout(nextAbout);
    setChannel(nextChannel ?? {
      channel_id: channelId,
      title: nextAbout?.title ?? channelId,
      thumbnail: nextAbout?.avatar ?? "",
      tags: [],
    });
    if (videosResult.status === "fulfilled") {
      setVideos(videosResult.value.videos);
      setPage(videosResult.value.page);
      setHasMore(videosResult.value.hasMore);
    } else {
      setVideos([]);
      setHasMore(false);
    }
    setLiveVideos(liveResult.status === "fulfilled" ? liveResult.value.videos : []);
    setLoading(false);
  }, [api, channelId]);
  const sync = useChannelSync(api, channelId, useCallback(() => load(true), [load]));

  useEffect(() => {
    setTab("videos");
    setAbout(null);
    setChannel(null);
    setVideos([]);
    setLiveVideos([]);
    void load();
    return () => { requestId.current += 1; };
  }, [load]);

  const split = useMemo(() => splitChannelVideos(videos), [videos]);
  const tabs = useMemo(
    () => channelContentTabs(videos, about?.counts, shortsEnabled).map((item) => ({
      ...item,
      label: item.value === "shorts" ? t("navShorts") : t("videos"),
    })),
    [about?.counts, shortsEnabled, t, videos],
  );
  const visibleVideos = tab === "shorts" ? split.shorts : split.videos;
  const visibleVideoIds = useMemo(() => visibleVideos.map(videoKey), [visibleVideos]);
  const pagination = usePaginationFocus(visibleVideoIds, columns, hasMore, `${channelId}:${tab}`);
  const gridPerformance = useMemo(() => tvGridListPerformance(columns), [columns]);
  const thumbnailSource = useCallback((thumbnail: string) => api.thumbnailSource(thumbnail), [api]);

  useEffect(() => {
    if (!tabs.some((item) => item.value === tab)) setTab("videos");
  }, [tab, tabs]);

  useEffect(() => {
    if (loading || !contentFocusAllowed) return;
    const target = firstTabTarget ?? firstVideoTarget ?? backTarget ?? (error ? retryRef.current : emptyRef.current);
    if (!target || handledFocusRequest.current === focusRequest) return;
    return focusWhenReady(target, () => { handledFocusRequest.current = focusRequest; });
  }, [backTarget, contentFocusAllowed, error, firstTabTarget, firstVideoTarget, focusRequest, loading]);

  useEffect(() => {
    if (loading) return;
    const target = firstTabTarget ?? firstVideoTarget ?? backTarget ?? (error ? retryRef.current : emptyRef.current);
    onPrimaryFocusTarget(target);
    return () => onPrimaryFocusTarget(null);
  }, [backTarget, error, firstTabTarget, firstVideoTarget, loading, onPrimaryFocusTarget]);


  const loadMore = async (beforeAppend?: () => Promise<void>) => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setPageError(false);
    const currentRequest = requestId.current;
    try {
      const result = await api.channelVideos(channelId, page + 1);
      if (currentRequest !== requestId.current) return;
      await beforeAppend?.();
      if (currentRequest !== requestId.current) return;
      setVideos((current) => [...current, ...result.videos]);
      setPage(result.page);
      setHasMore(result.videos.length === result.limit);
    } catch {
      if (currentRequest === requestId.current) setPageError(true);
    } finally {
      if (currentRequest === requestId.current) setLoadingMore(false);
    }
  };

  const toggleFollow = async () => {
    if (!channel || followBusy) return;
    const followed = channel.followed === 1;
    setFollowBusy(true);
    setFollowError(false);
    try {
      await api.followChannel(channel.channel_id, !followed);
      setChannel((current) => current ? { ...current, followed: followed ? 0 : 1 } : current);
    } catch {
      setFollowError(true);
    } finally {
      setFollowBusy(false);
    }
  };

  const applyVideoChange = useCallback((updated: Video) => {
    setVideos((current) => current.map((video) => video.video_id === updated.video_id ? updated : video));
    setLiveVideos((current) => current.map((video) => video.video_id === updated.video_id ? updated : video));
  }, []);

  useEffect(() => { if (videoUpdate) applyVideoChange(videoUpdate); }, [applyVideoChange, videoUpdate]);

  const renderVideo = useCallback(({ item, index }: ListRenderItemInfo<Video>) => {
    const focusProps = {
      ref: pagination.itemRef(item.video_id, index === 0 ? setFirstVideoTarget : undefined),
      nextFocusDown: pagination.down(index),
      nextFocusUp: index < columns ? firstTabTarget ?? firstLiveTarget ?? backTarget ?? profileFocusTarget : undefined,
      onFocusChange: (focused: boolean) => { pagination.onItemFocus(item.video_id, focused); },
      onLongPress: () => onVideoLongPress(item, applyVideoChange),
      onPress: () => onOpen(item, sessionContext(visibleVideos)),
      channelSource: api.thumbnailSource(item.channel_thumbnail ?? channel?.thumbnail ?? ""),
    };
    return tab === "shorts" ? (
      <TvShortCard
        {...focusProps}
        video={item}
        width={cardWidth}
        language={language}
        portraitSource={api.shortThumbnailSource(item.video_id)}
        fallbackSource={api.thumbnailSource(item.thumbnail)}
        viewsLabel={t("views")}
      />
    ) : (
      <VideoCard
        {...focusProps}
        video={item}
        width={cardWidth}
        language={language}
        thumbnailSource={api.thumbnailSource(item.thumbnail)}
        viewsLabel={t("views")}
      />
    );
  }, [pagination, api, applyVideoChange, backTarget, cardWidth, channel?.thumbnail, columns, firstLiveTarget, firstTabTarget, language, onOpen, onVideoLongPress, profileFocusTarget, t, tab, visibleVideos]);

  if (loading) {
    return (
      <View style={[styles.loadingScreen, { width, height }]}><TvPageBackButton ref={setBackTarget} t={t} onPress={onBack} />
        <TvLoadingMark accessibilityLabel={t("loadingChannel")} />
      </View>
    );
  }

  if (error || !channel) {
    return (
      <View style={[styles.errorScreen, { width, height }]}><TvPageBackButton ref={setBackTarget} t={t} nextFocusDown={retryRef.current ?? undefined} onPress={onBack} />
        <Text style={styles.errorTitle}>{t("channelLoadError")}</Text>
        <View style={styles.errorActions}>
          <TvButton ref={retryRef} label={t("refresh")} preferredFocus onPress={() => void load()} />

        </View>
      </View>
    );
  }

  const title = about?.title || channel.title;
  const avatar = about?.avatar || channel.thumbnail;
  const description = about?.description || channel.description || "";
  const handle = about?.handle || channel.handle || "";
  const subscriberCount = about?.subscriberCount || channel.subscriber_count || "";
  const followed = channel.followed === 1;
  const inactive = channel.manual_status && channel.manual_status !== "active";

  const header = (
    <View>
      <View style={styles.hero}>
        {about?.banner ? <Image source={imageSourceWithHeaders(api.thumbnailSource(about.banner))} resizeMode="cover" style={styles.banner} /> : null}
        <View style={styles.heroShade} />
        <View style={styles.heroContent}>
          <View style={styles.avatarFrame}>
            {avatar ? <Image source={imageSourceWithHeaders(api.thumbnailSource(avatar))} resizeMode="cover" style={styles.avatar} /> : <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.avatarInitial}>{title.trim()[0]?.toLocaleUpperCase() ?? "?"}</Text></View>}
          </View>
          <View style={styles.heroCopy}>
            <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>{title}</Text>
            {(handle || subscriberCount) && (
              <Text numberOfLines={1} style={styles.meta}>
                {[handle, subscriberCount ? `${subscriberCount} ${t("subscribers")}` : ""].filter(Boolean).join("  •  ")}
              </Text>
            )}
            {description ? <Text numberOfLines={2} style={styles.description}>{description}</Text> : null}
            {channel.tags.length > 0 && (
              <View style={styles.tags}>
                {channel.tags.slice(0, 6).map((tag) => <View key={tag.id} style={styles.tag}><Text numberOfLines={1} style={styles.tagLabel}>{tag.name}</Text></View>)}
              </View>
            )}
            {inactive && <Text style={styles.inactive}>{t("channelInactive")}</Text>}
            {followError && <Text style={styles.followError}>{t("channelFollowError")}</Text>}
            {sync.statusError ? <Text style={styles.followError}>{t("channelSyncStatusError")}</Text>
              : !sync.working && sync.result ? <Text style={sync.result === "error" ? styles.followError : styles.syncStatus}>{t(sync.result === "error" ? "channelSyncFailed" : "channelSyncComplete")}</Text>
              : sync.busy && !sync.working ? <Text style={styles.syncStatus}>{t("channelSyncBusy")}</Text> : null}
          </View>
          <View style={styles.heroActions}>
            <TvButton ref={setFollowTarget} disabled={followBusy} label={followed ? t("unfollow") : t("follow")} variant={followed ? "default" : "primary"} nextFocusUp={backTarget ?? profileFocusTarget} onPress={() => void toggleFollow()} />
            <TvButton label={sync.statusError ? t("refresh") : sync.working ? t("syncingChannel") : t("syncChannel")}
              disabled={Boolean(inactive) || Boolean(sync.busy && !sync.working && !sync.statusError)} accessibilityState={{ busy: sync.working }}
              nextFocusUp={followTarget ?? undefined} nextFocusDown={firstLiveTarget ?? firstTabTarget ?? firstVideoTarget ?? undefined}
              onPress={() => { if (sync.statusError || sync.checking) sync.refresh(); else if (!sync.working) void sync.start(); }} />
          </View>
        </View>
      </View>

      <TvVideoShelf
        title={t("liveBadge")}
        videos={liveVideos}
        cardWidth={shelfCardWidth}
        firstItemRef={setFirstLiveTarget}
        language={language}
        nextFocusUp={followTarget ?? backTarget ?? profileFocusTarget}
        nextFocusDown={firstTabTarget ?? firstVideoTarget ?? undefined}
        thumbnailSource={thumbnailSource}
        onOpen={onOpen}
        onLongPress={(video) => onVideoLongPress(video, applyVideoChange)}
        viewsLabel={t("views")}
      />

      <TvTabBar
        value={tab}
        options={tabs}
        firstItemRef={setFirstTabTarget}
        nextFocusUp={firstLiveTarget ?? followTarget ?? backTarget ?? profileFocusTarget}
        nextFocusDown={firstVideoTarget ?? undefined}
        onChange={(next) => {
          setFirstVideoTarget(null);
          setTab(next);
        }}
      />
    </View>
  );

  return (
    <View style={[styles.screen, { width, height }]}>
      <TvPageBackButton ref={setBackTarget} t={t} nextFocusRight={profileFocusTarget} nextFocusDown={followTarget ?? firstTabTarget ?? undefined} onPress={onBack} />
      <TvGridList
        ref={listRef}
        key={`channel-${columns}`}
        style={[styles.list, { width, height }]}
        contentContainerStyle={[styles.content, { minHeight: height }]}
        data={visibleVideos}
        columns={columns}
        rowStyle={styles.row}
        keyExtractor={videoKey}
        ListHeaderComponent={header}
        ListEmptyComponent={!error ? (
          <TvEmptyState compact icon={tab === "shorts" ? "shorts" : "playlists"} title={tab === "shorts" ? t("channelShortsEmpty") : t("channelVideosEmpty")}
            action={<TvButton ref={emptyRef} label={t("refresh")} onPress={() => void load()} />} />
        ) : null}
        ListFooterComponent={hasMore && visibleVideos.length > 0 ? (
          <TVFocusGuideView destinations={pagination.destinations} style={styles.footer}>
            {pageError ? <Text style={styles.followError}>{t("channelLoadError")}</Text> : null}
            <TvButton ref={pagination.buttonRef} onFocus={pagination.onButtonFocus} onBlur={pagination.onButtonBlur} nextFocusUp={pagination.up} label={loadingMore ? t("loadingChannel") : pageError ? t("tryAgain") : t("loadMore")} accessibilityState={{ busy: loadingMore }} onPress={() => { if (!loadingMore && !loading) void pagination.load(loadMore); }} />
          </TVFocusGuideView>
        ) : null}
        renderItem={renderVideo}
        {...gridPerformance}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 0, flexShrink: 0, backgroundColor: colors.background },
  loadingScreen: { flexGrow: 0, flexShrink: 0, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  list: { flexGrow: 0, flexShrink: 0 },
  content: { paddingHorizontal: screenPadding + 20, paddingTop: 132, paddingBottom: 90 },
  hero: { minHeight: 286, marginBottom: 34, borderRadius: 30, overflow: "hidden", backgroundColor: colors.surface },
  banner: { ...StyleSheet.absoluteFill, width: "100%", height: "100%", opacity: 0.58 },
  heroShade: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(5,5,6,0.52)" },
  heroContent: { minHeight: 286, paddingHorizontal: 34, paddingVertical: 30, paddingRight: 40, flexDirection: "row", alignItems: "center", gap: 28 },
  avatarFrame: { width: 148, height: 148, borderRadius: 74, overflow: "hidden", backgroundColor: colors.surfaceRaised, shadowColor: colors.black, shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 10 } },
  avatar: { width: "100%", height: "100%", backgroundColor: colors.surfaceRaised },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  avatarInitial: { color: colors.white, fontSize: 54, fontWeight: "800" },
  heroCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 44, lineHeight: 51, fontWeight: "800", letterSpacing: -1.25 },
  meta: { color: colors.text, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "600", marginTop: 6, opacity: 0.82 },
  description: { color: colors.text, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, marginTop: 13, maxWidth: 740, opacity: 0.78 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  tag: { maxWidth: 170, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 11, backgroundColor: "rgba(255,255,255,0.12)" },
  tagLabel: { color: colors.text, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "700" },
  inactive: { color: colors.warning, fontSize: typography.caption.fontSize, fontWeight: "700", marginTop: 11 },
  followError: { color: colors.danger, fontSize: typography.caption.fontSize, fontWeight: "700", marginTop: 8 },
  syncStatus: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, marginTop: 10 },
  heroActions: { alignItems: "stretch", gap: 12, minWidth: 170 },
  row: { gap: 28 },
  footer: { alignItems: "center", paddingTop: 12, paddingBottom: 30 },
  errorScreen: { backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  errorTitle: { color: colors.text, fontSize: 34, lineHeight: 42, fontWeight: "800" },
  errorActions: { flexDirection: "row", gap: 14, marginTop: 26 },
});
