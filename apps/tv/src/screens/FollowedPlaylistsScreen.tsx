import { TvEmptyState } from "../components/TvEmptyState";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Image, StyleSheet, Text, TVFocusGuideView, View, type FocusDestination, type ListRenderItemInfo } from "react-native";
import type { YtZeroApi } from "../api";
import { focusWhenReady, useContentFocusAllowed } from "../focus";
import type { Translate } from "../i18n";
import { localeTags } from "../i18n";
import type { OpenVideo } from "../playbackQueue";
import type { FollowedPlaylist, Language, Video } from "../types";
import { colors, typography, screenPadding } from "../theme";
import { tvVerticalListPerformance } from "../listPerformance";
import { TvButton } from "../components/TvButton";
import { TvListButton } from "../components/TvListButton";
import { TvLoadingMark } from "../components/TvLoadingMark";
import { TvPageHeading } from "../components/TvPageHeading";
import { TvGlassVisibility } from "../components/TvGlassSurface";
import type { VideoActionOptions } from "../components/TvVideoActionMenu";
import { PlaylistScreen } from "./PlaylistScreen";
import { imageSourceWithHeaders } from "../imageSource";

type Props = {
  api: YtZeroApi; language: Language; t: Translate; selectedId: string | null;
  onSelect: (id: string) => void; onBack: () => void; onOpen: OpenVideo;
  onVideoLongPress: (video: Video, onChange: (video: Video) => void, options?: VideoActionOptions) => void;
  videoUpdate: Video | null; focusRequest: number; profileFocusTarget: FocusDestination;
  onPrimaryFocusTarget: (target: View | null) => void; viewportWidth: number; viewportHeight: number;
};

const playlistKey = (playlist: FollowedPlaylist) => playlist.playlist_id;
const renderSeparator = () => <View style={styles.separator} />;

export function FollowedPlaylistsScreen(props: Props) {
  const { api, language, t, selectedId, onSelect, onPrimaryFocusTarget, focusRequest, profileFocusTarget, viewportWidth: width, viewportHeight: height } = props;
  const allowed = useContentFocusAllowed();
  const [playlists, setPlaylists] = useState<FollowedPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [firstTarget, setFirstTarget] = useState<View | null>(null);
  const [retryTarget, setRetryTarget] = useState<View | null>(null);
  const targets = useRef(new Map<string, View>());
  const targetRefs = useRef(new Map<string, { index: number; callback: (target: View | null) => void }>());
  const selected = useRef<string | null>(null);
  const generation = useRef(0);
  const handled = useRef<number | null>(null);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError(false);
    try {
      const result = await api.followedPlaylists();
      if (generation.current === request) setPlaylists(result.playlists);
    } catch { if (generation.current === request) setError(true); }
    finally { if (generation.current === request) setLoading(false); }
  }, [api]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  useEffect(() => {
    if (selectedId || loading || !allowed || handled.current === focusRequest) return;
    const target = (selected.current ? targets.current.get(selected.current) : null) ?? firstTarget ?? retryTarget;
    if (target) return focusWhenReady(target, () => { handled.current = focusRequest; });
  }, [allowed, firstTarget, focusRequest, loading, retryTarget, selectedId]);
  useEffect(() => {
    if (selectedId) return;
    onPrimaryFocusTarget(loading ? null : firstTarget ?? retryTarget);
    return () => onPrimaryFocusTarget(null);
  }, [firstTarget, loading, onPrimaryFocusTarget, retryTarget, selectedId]);
  const count = useMemo(() => new Intl.NumberFormat(localeTags[language]), [language]);
  const selectPlaylist = useCallback((playlistId: string) => {
    selected.current = playlistId;
    onSelect(playlistId);
  }, [onSelect]);
  const targetRef = useCallback((playlistId: string, index: number) => {
    const existing = targetRefs.current.get(playlistId);
    if (existing?.index === index) return existing.callback;
    const callback = (target: View | null) => {
      if (target) targets.current.set(playlistId, target);
      else targets.current.delete(playlistId);
      if (index === 0) setFirstTarget(target);
    };
    targetRefs.current.set(playlistId, { index, callback });
    return callback;
  }, []);
  const renderPlaylist = useCallback(({ item, index }: ListRenderItemInfo<FollowedPlaylist>) => (
    <TvListButton
      ref={targetRef(item.playlist_id, index)}
      deferPress
      leading={<Image source={imageSourceWithHeaders(api.thumbnailSource(item.thumbnail))} style={styles.thumbnail} resizeMode="cover" />}
      label={item.title}
      detail={`${item.channel_title} · ${t("videos")}: ${count.format(Number(item.video_count) || 0)}`}
      nextFocusUp={index === 0 ? profileFocusTarget : undefined}
      onPress={() => selectPlaylist(item.playlist_id)}
    />
  ), [api, count, profileFocusTarget, selectPlaylist, t, targetRef]);
  return <View style={[styles.screen, { width, height }]}>
    <TvGlassVisibility visible={!selectedId}>
    <TVFocusGuideView autoFocus focusable={!selectedId} accessibilityElementsHidden={Boolean(selectedId)}
      importantForAccessibility={selectedId ? "no-hide-descendants" : "auto"} style={[styles.screen, { width, height }, selectedId && styles.hidden]}>
      <FlatList data={playlists} keyExtractor={playlistKey} style={[styles.list, { width, height }]} contentContainerStyle={styles.content}
        {...tvVerticalListPerformance}
        ListHeaderComponent={<TvPageHeading title={t("navFollowedPlaylists")} />}
        ListEmptyComponent={loading ? <View style={styles.empty}><TvLoadingMark accessibilityLabel={t("loadingPlaylists")} /></View>
          : <TvEmptyState art={error ? undefined : "playlistEmpty"} icon="playlists" title={t(error ? "playlistsLoadError" : "tvEmptyFollowedPlaylistsEmptyTitle")}
            description={error ? undefined : t("tvEmptyFollowedPlaylistsEmptyDescription")}
            action={<TvButton ref={setRetryTarget} label={t("refresh")} onPress={() => void load()} />} />}
        ListFooterComponent={playlists.length > 0 ? <View style={styles.footer}>
          {error && playlists.length > 0 ? <Text style={styles.hint}>{t("playlistsLoadError")}</Text> : null}
          <TvButton ref={setRetryTarget} label={t("refresh")} focusable={!loading || handled.current !== null} accessibilityState={{ busy: loading }} onPress={() => { if (!loading) void load(); }} />
        </View> : null}
        ItemSeparatorComponent={renderSeparator}
        renderItem={renderPlaylist}
      />
    </TVFocusGuideView>
    </TvGlassVisibility>
    {selectedId ? <View style={StyleSheet.absoluteFill}><PlaylistScreen key={selectedId} {...props} playlistId={selectedId} /></View> : null}
  </View>;
}
const styles = StyleSheet.create({
  screen: { flexGrow: 0, flexShrink: 0, backgroundColor: colors.background }, hidden: { opacity: 0 },
  list: { flexGrow: 0, flexShrink: 0 },
  content: { paddingHorizontal: screenPadding + 20, paddingTop: 132, paddingBottom: 90 },
  thumbnail: { width: 192, height: 108, borderRadius: 14, backgroundColor: colors.surfaceRaised },
  separator: { height: 20 }, empty: { paddingVertical: 100, alignItems: "center", gap: 20 },
  hint: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: 30, maxWidth: 840, textAlign: "center" },
  footer: { paddingTop: 30, alignItems: "center", gap: 20 },
});
