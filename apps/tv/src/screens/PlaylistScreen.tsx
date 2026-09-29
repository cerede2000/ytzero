import { TvEmptyState } from "../components/TvEmptyState";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, StyleSheet, Text, View, type FocusDestination, type ListRenderItemInfo } from "react-native";
import type { YtZeroApi } from "../api";
import { requestTvFocus, focusWhenReady, useContentFocusAllowed, useVideoFocusMemory } from "../focus";
import { restoreFocus } from "../focusRestoration";
import type { Translate } from "../i18n";
import { localeTags } from "../i18n";
import { normalizePlaylistSort, playlistContinueTarget, playlistQueue, playlistVideos, type PlaylistSort } from "../playlist";
import type { OpenVideo } from "../playbackQueue";
import type { FollowedPlaylist, Language, Video } from "../types";
import { colors, typography, screenPadding } from "../theme";
import { tvGridListPerformance } from "../listPerformance";
import { TvChoiceSheet } from "../components/TvChoiceSheet";
import { TvButton } from "../components/TvButton";
import { TvPageBackButton } from "../components/TvPageBackButton";
import { TvLoadingMark } from "../components/TvLoadingMark";
import { VideoCard } from "../components/VideoCard";
import type { VideoActionOptions } from "../components/TvVideoActionMenu";
import { TvGridList } from "../components/TvGridList";
import { imageSourceWithHeaders } from "../imageSource";

const emptyVideos: Video[] = [];
const videoKey = (video: Video) => video.video_id;

type Props = {
  api: YtZeroApi; language: Language; t: Translate; playlistId: string;
  onBack: () => void; onOpen: OpenVideo; videoUpdate: Video | null;
  onVideoLongPress: (video: Video, onChange: (video: Video) => void, options?: VideoActionOptions) => void;
  focusRequest: number; profileFocusTarget: FocusDestination; onPrimaryFocusTarget: (target: View | null) => void;
  viewportWidth: number; viewportHeight: number;
};
export function PlaylistScreen({ api, language, t, playlistId, onBack, onOpen, videoUpdate, onVideoLongPress, focusRequest, profileFocusTarget, onPrimaryFocusTarget, viewportWidth: width, viewportHeight: height }: Props) {
  const allowed = useContentFocusAllowed();
  const [page, setPage] = useState<{ playlist: FollowedPlaylist; videos: Video[]; sort: PlaylistSort } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [backTarget, setBackTarget] = useState<View | null>(null);
  const [playTarget, setPlayTarget] = useState<View | null>(null);
  const [continueTarget, setContinueTarget] = useState<View | null>(null);
  const [retryTarget, setRetryTarget] = useState<View | null>(null);
  const [firstVideoTarget, setFirstVideoTarget] = useState<View | null>(null);
  const playFocus = useVideoFocusMemory(setPlayTarget);
  const continueFocus = useVideoFocusMemory(setContinueTarget);
  const [sortOpen, setSortOpen] = useState(false);
  const [sortSaving, setSortSaving] = useState(false);
  const [sortError, setSortError] = useState(false);
  const sortLock = useRef(false);
  const sortTarget = useRef<View>(null);
  const sortVisible = useRef(false);
  const restoreSortFocus = useRef<(() => void) | null>(null);
  const generation = useRef(0);
  const handled = useRef<number | null>(null);
  const columns = width >= 1400 ? 4 : 3;
  const cardWidth = Math.floor((width - (screenPadding + 20) * 2 - (columns - 1) * 28) / columns);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError(false);
    try {
      const [details, contents] = await Promise.all([api.channelPlaylist(playlistId), api.channelPlaylistVideos(playlistId)]);
      if (generation.current === request) setPage({ playlist: details.playlist, videos: playlistVideos(contents), sort: normalizePlaylistSort(contents.sort) });
    } catch { if (generation.current === request) setError(true); }
    finally { if (generation.current === request) setLoading(false); }
  }, [api, playlistId]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  useEffect(() => () => restoreSortFocus.current?.(), []);
  const updateVideo = useCallback((video: Video) => {
    setPage((current) => current ? { ...current, videos: current.videos.map((item) => item.video_id === video.video_id ? video : item) } : null);
  }, []);
  useEffect(() => { if (videoUpdate) updateVideo(videoUpdate); }, [updateVideo, videoUpdate]);
  const primary = continueTarget ?? playTarget ?? retryTarget ?? backTarget;
  useEffect(() => {
    onPrimaryFocusTarget(loading && !page ? null : primary);
    return () => onPrimaryFocusTarget(null);
  }, [loading, onPrimaryFocusTarget, page !== null, primary]);
  useEffect(() => {
    if (!allowed || loading || !primary || handled.current === focusRequest) return;
    return focusWhenReady(primary, () => { handled.current = focusRequest; });
  }, [allowed, focusRequest, loading, primary]);
  const context = useMemo(() => playlistQueue(playlistId, page?.sort ?? "oldest"), [page?.sort, playlistId]);
  const count = useMemo(() => new Intl.NumberFormat(localeTags[language]), [language]);
  const sortOptions: Array<{ value: PlaylistSort; label: string }> = useMemo(() => [
    { value: "playlist-order", label: t("playlistSortOrder") }, { value: "oldest", label: t("playlistSortOldest") },
    { value: "newest", label: t("playlistSortNewest") }, { value: "title-asc", label: t("playlistSortTitleAsc") },
    { value: "title-desc", label: t("playlistSortTitleDesc") },
  ], [t]);
  const closeSort = () => {
    if (!sortVisible.current) return;
    sortVisible.current = false;
    setSortOpen(false);
    restoreSortFocus.current?.();
    restoreSortFocus.current = restoreFocus(() => sortTarget.current, requestTvFocus);
  };
  const changeSort = async (sort: PlaylistSort) => {
    if (sortLock.current) return;
    sortLock.current = true; setSortSaving(true); setSortError(false);
    const request = ++generation.current;
    try {
      await api.updatePlaylistSort(playlistId, sort);
      const contents = await api.channelPlaylistVideos(playlistId);
      if (request !== generation.current) return;
      setPage((current) => current ? { ...current, videos: playlistVideos(contents), sort: normalizePlaylistSort(contents.sort) } : null);
      closeSort();
    } catch { if (request === generation.current) setSortError(true); }
    finally { sortLock.current = false; if (request === generation.current) setSortSaving(false); }
  };
  const continuation = page ? playlistContinueTarget(page.videos) : null;
  const first = page?.videos[0];
  const videos = page?.videos ?? emptyVideos;
  const renderVideo = useCallback(({ item, index }: ListRenderItemInfo<Video>) => (
    <VideoCard ref={index === 0 ? setFirstVideoTarget : undefined} video={item} width={cardWidth} language={language}
      thumbnailSource={api.thumbnailSource(item.thumbnail)} channelSource={api.thumbnailSource(item.channel_thumbnail ?? page?.playlist.channel_thumbnail ?? "")}
      viewsLabel={t("views")} nextFocusUp={index < columns ? continueTarget ?? playTarget ?? backTarget ?? undefined : undefined}
      onPress={() => onOpen(item, context)} onLongPress={() => onVideoLongPress(item, updateVideo)} />
  ), [api, backTarget, cardWidth, columns, context, continueTarget, language, onOpen, onVideoLongPress, page?.playlist.channel_thumbnail, playTarget, t, updateVideo]);
  return <View style={[styles.screen, { width, height }]}>
    <TvPageBackButton ref={setBackTarget} t={t} onPress={onBack} nextFocusRight={profileFocusTarget} nextFocusDown={continueTarget ?? playTarget ?? retryTarget ?? undefined} />
    {loading && !page ? <View style={styles.loading}><TvLoadingMark accessibilityLabel={t("loadingPlaylists")} /></View> : <TvGridList
      key={columns} style={[styles.list, { width, height }]} data={videos} columns={columns} keyExtractor={videoKey}
      {...tvGridListPerformance(columns)} contentContainerStyle={styles.content} rowStyle={styles.row}
      ListHeaderComponent={<View>
        {page ? <View style={styles.hero}>
          <Image source={imageSourceWithHeaders(api.thumbnailSource(page.playlist.thumbnail))} style={styles.thumbnail} />
          <View style={styles.copy}>
            <Text accessibilityRole="header" style={styles.title}>{page.playlist.title}</Text>
            <Text style={styles.meta}>{page.playlist.channel_title} · {t("videos")}: {count.format(page.videos.length)}</Text>
            <View style={styles.actions}>
              {continuation ? <TvButton ref={continueFocus.ref} deferPress label={t("continueWatching")} icon="play" onPress={() => { continueFocus.remember(); onOpen(continuation, context, true); }} nextFocusUp={backTarget ?? undefined} nextFocusDown={firstVideoTarget ?? undefined} /> : null}
              {first ? <TvButton ref={playFocus.ref} deferPress label={t("playlistPlayAll")} icon="play" onPress={() => { playFocus.remember(); onOpen(first, context, true); }} nextFocusUp={backTarget ?? undefined} nextFocusDown={firstVideoTarget ?? undefined} /> : null}
              <TvButton ref={sortTarget} deferPress label={`${t("playlistSort")}: ${sortOptions.find((option) => option.value === page.sort)?.label}`}
                onPress={() => { restoreSortFocus.current?.(); sortVisible.current = true; setSortError(false); setSortOpen(true); }} nextFocusUp={backTarget ?? undefined} nextFocusDown={firstVideoTarget ?? undefined} />
            </View>
          </View>
        </View> : null}
        {error ? <View style={styles.error}><Text style={styles.hint}>{t("playlistsLoadError")}</Text><TvButton ref={setRetryTarget} label={t("tryAgain")} onPress={() => void load()} /></View> : null}
      </View>}
      ListEmptyComponent={!error ? <TvEmptyState compact icon="playlists" title={t("playlistVideosEmpty")} action={<TvButton ref={setRetryTarget} label={t("refresh")} onPress={() => void load()} />} /> : null}
      renderItem={renderVideo}
    />}
    {sortOpen && page ? <TvChoiceSheet title={t("playlistSort")} options={sortOptions} value={page.sort} busy={sortSaving}
      error={sortError ? t("actionFailed") : undefined} t={t} onSelect={(sort) => void changeSort(sort)} onClose={closeSort} /> : null}
  </View>;
}
const styles = StyleSheet.create({
  screen: { flexGrow: 0, flexShrink: 0, backgroundColor: colors.background }, list: { flexGrow: 0, flexShrink: 0 }, content: { paddingHorizontal: screenPadding + 20, paddingTop: 132, paddingBottom: 90 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  hero: { flexDirection: "row", alignItems: "center", gap: 36, marginBottom: 44 }, thumbnail: { width: 320, aspectRatio: 16 / 9, borderRadius: 24, backgroundColor: colors.surface },
  copy: { flex: 1, gap: 16 }, title: { color: colors.text, fontSize: 38, lineHeight: 46, fontWeight: "700" }, meta: { color: colors.textMuted, fontSize: typography.caption.fontSize },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 18, marginTop: 10 }, row: { gap: 28 },
  empty: { paddingVertical: 90, alignItems: "center", gap: 22 }, error: { paddingVertical: 30, alignItems: "center", gap: 20 },
  hint: { color: colors.textMuted, fontSize: 24, lineHeight: 32, textAlign: "center" },
});
