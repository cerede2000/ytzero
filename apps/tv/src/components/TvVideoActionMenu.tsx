import { TvEmptyState } from "./TvEmptyState";
import { TvCloseButton } from "./TvCloseButton";
import { formatVideoDuration } from "../duration";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  TVFocusGuideView,
  useWindowDimensions,
  View,
} from "react-native";
import type { YtZeroApi } from "../api";
import type { Translate } from "../i18n";
import { tvVerticalListPerformance } from "../listPerformance";
import { colors, typography } from "../theme";
import type { Bucket, UserPlaylist, Video } from "../types";
import { visibleTvVideoCardActions, type TvVideoCardActionId, type VideoCardActionConfig } from "../videoCardActions";
import { TvButton } from "./TvButton";
import { TvLoadingMark } from "./TvLoadingMark";
import { TvListButton } from "./TvListButton";
import { TvScreenTransition } from "./TvScreenTransition";
import { useSessionQueue } from "../SessionQueue";
import { SESSION_QUEUE_LIMIT } from "../playbackQueue";
import { useTvModalBack } from "../useTvModalBack";
import { TvFocusScope } from "./TvFocusScope";
import { requestTvFocus } from "../focus";
import { restoreFocus } from "../focusRestoration";
import { imageSourceWithHeaders } from "../imageSource";

type MenuView = "actions" | "schedule" | "playlists";

export type VideoActionOptions = {
  onRemove?: () => Promise<void>;
};

type Props = {
  api: YtZeroApi;
  actionConfig: VideoCardActionConfig;
  onClose: () => void;
  onOpenChannel: (channelId: string) => void;
  onRemove?: () => Promise<void>;
  onVideoChange: (video: Video) => void;
  preserveMenuKey: boolean;
  t: Translate;
  video: Video | null;
};

const scheduleBuckets: Array<{ bucket: Bucket; label: "scheduleToday" | "scheduleTonight" | "scheduleTomorrow" | "scheduleTomorrowEvening" | "scheduleWeekend" }> = [
  { bucket: "today", label: "scheduleToday" },
  { bucket: "tonight", label: "scheduleTonight" },
  { bucket: "tomorrow", label: "scheduleTomorrow" },
  { bucket: "tomorrow_evening", label: "scheduleTomorrowEvening" },
  { bucket: "weekend", label: "scheduleWeekend" },
];

export function TvVideoActionMenu(props: Props) {
  return props.video ? <VideoActionMenu key={props.video.video_id} {...props} video={props.video} /> : null;
}

function VideoActionMenu({ api, actionConfig, onClose, onOpenChannel, onRemove, onVideoChange, preserveMenuKey, t, video }: Props & { video: Video }) {
  const queue = useSessionQueue();
  const { height, fontScale } = useWindowDimensions();
  const queued = queue.items.some((item) => item.video_id === video?.video_id);
  const [view, setView] = useState<MenuView>("actions");
  const [currentVideo, setCurrentVideo] = useState(video);
  const [playlists, setPlaylists] = useState<UserPlaylist[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [verifiedId, setVerifiedId] = useState<string | null>(null);
  const [metadataError, setMetadataError] = useState(false);
  const [metadataRequest, setMetadataRequest] = useState(0);
  const [shown, setShown] = useState(false);
  const [firstTarget, setFirstTarget] = useState<View | null>(null);
  const [closeTarget, setCloseTarget] = useState<View | null>(null);
  const [focusedView, setFocusedView] = useState<MenuView | null>(null);
  useEffect(() => {
    let active = true;
    setVerifiedId(null);
    setMetadataError(false);
    if (video) void api.video(video.video_id).then((result) => {
      if (!active) return;
      setCurrentVideo(result.video);
      setVerifiedId(video.video_id);
    }).catch(() => { if (active) setMetadataError(true); });
    return () => { active = false; };
  }, [api, video?.video_id, metadataRequest]);

  const close = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  const goBack = useCallback(() => {
    if (busy) return;
    if (view === "actions") close();
    else {
      setError(false);
      setFocusedView(null);
      setView("actions");
    }
  }, [busy, close, view]);

  useTvModalBack(true, goBack, preserveMenuKey);

  const actions = useMemo(
    () => currentVideo ? visibleTvVideoCardActions(actionConfig, currentVideo, Boolean(onRemove), queued) : [],
    [actionConfig, currentVideo, onRemove, queued],
  );

  const updateVideo = useCallback((next: Video) => {
    setCurrentVideo(next);
    onVideoChange(next);
  }, [onVideoChange]);

  const run = useCallback(async (id: string, action: () => Promise<void>, closeAfter = true) => {
    if (busy) return;
    setBusy(id);
    setError(false);
    try {
      await action();
      if (closeAfter) onClose();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }, [busy, onClose]);

  const openPlaylists = useCallback(() => {
    if (!currentVideo || busy) return;
    setFocusedView(null);
    setView("playlists");
    setPlaylists(null);
    setError(false);
    void api.userPlaylists(currentVideo.video_id)
      .then((result) => setPlaylists(result.playlists))
      .catch(() => {
        setPlaylists([]);
        setError(true);
      });
  }, [api, busy, currentVideo]);

  const selectAction = useCallback((id: TvVideoCardActionId) => {
    if (!currentVideo || busy || verifiedId !== currentVideo.video_id || !actions.includes(id)) return;
    if (id === "sessionQueue") {
      if (queued) queue.remove(currentVideo.video_id);
      else if (queue.items.length < SESSION_QUEUE_LIMIT) queue.add(currentVideo);
      else return;
      onClose();
      return;
    }
    if (id === "schedule") {
      setError(false);
      setFocusedView(null);
      setView("schedule");
      return;
    }
    if (id === "playlist") return openPlaylists();
    if (id === "download") {
      const active = currentVideo.download_status === "queued" || currentVideo.download_status === "downloading";
      void run(id, async () => {
        if (active) await api.cancelVideoDownload(currentVideo.video_id);
        else await api.downloadVideo(currentVideo.video_id);
        updateVideo({ ...currentVideo, download_status: active ? null : "queued" });
      });
      return;
    }
    if (id === "archive") {
      void run(id, async () => {
        await api.reject(currentVideo.video_id);
        updateVideo({ ...currentVideo, status: "archived", bucket: null });
      });
      return;
    }
    if (id === "restore") {
      void run(id, async () => {
        await api.restore(currentVideo.video_id);
        updateVideo({ ...currentVideo, status: "inbox", bucket: null });
      });
      return;
    }
    if (id === "remove" && onRemove) {
      void run(id, onRemove);
      return;
    }
    const watched = currentVideo.watched === 1;
    void run(id, async () => {
      if (watched) {
        await api.markUnwatched(currentVideo.video_id);
        updateVideo({ ...currentVideo, watched: 0 });
      } else {
        await api.markWatched(currentVideo.video_id);
        await api.reject(currentVideo.video_id);
        updateVideo({ ...currentVideo, watched: 1, status: "archived", bucket: null });
      }
    });
  }, [actions, api, busy, currentVideo, onClose, onRemove, openPlaylists, queue, queued, run, updateVideo, verifiedId]);

  const chooseSchedule = useCallback((bucket: Bucket) => {
    if (!currentVideo || busy) return;
    const remove = currentVideo.status === "queued" && currentVideo.bucket === bucket;
    void run(`schedule-${bucket}`, async () => {
      if (remove) await api.dequeue(currentVideo.video_id);
      else await api.queue(currentVideo.video_id, bucket);
      updateVideo({
        ...currentVideo,
        status: remove ? "inbox" : "queued",
        bucket: remove ? null : bucket,
      });
    });
  }, [api, busy, currentVideo, run, updateVideo]);

  const togglePlaylist = useCallback((playlist: UserPlaylist, value: boolean) => {
    if (!currentVideo || busy) return;
    void run(`playlist-${playlist.id}`, async () => {
      if (value) await api.addVideoToUserPlaylist(playlist.id, currentVideo.video_id);
      else await api.removeVideoFromUserPlaylist(playlist.id, currentVideo.video_id);
      setPlaylists((items) => items?.map((item) => item.id === playlist.id ? {
        ...item,
        has_video: value ? 1 : 0,
        video_count: Math.max(0, item.video_count + (value ? 1 : -1)),
      } : item) ?? items);
    }, false);
  }, [api, busy, currentVideo, run]);

  const actionLabel = (id: TvVideoCardActionId): string => {
    switch (id) {
      case "sessionQueue": return t(queued ? "removeFromQueue" : queue.items.length >= SESSION_QUEUE_LIMIT ? "queueFull" : "addToQueue");
      case "schedule": return t("scheduleVideo");
      case "playlist": return t("addToPlaylist");
      case "download": return currentVideo.download_status === "queued" || currentVideo.download_status === "downloading" ? t("cancelDownload") : t("downloadVideo");
      case "archive": return t("reject");
      case "watched": return currentVideo.watched === 1 ? t("markUnwatched") : t("markWatched");
      case "restore": return t("restoreVideo");
      case "remove": return t("removeFromHistory");
    }
  };
  const mainItems: Array<"channel" | TvVideoCardActionId> = [
    ...(currentVideo.channel_id ? ["channel" as const] : []),
    ...actions,
  ];
  const scheduleItems = scheduleBuckets.map(({ bucket }) => bucket);
  const firstAction = mainItems.find((item) => item !== "sessionQueue" || queued || queue.items.length < SESSION_QUEUE_LIMIT);
  const empty = (view === "playlists" && playlists?.length === 0)
    || (view === "actions" && verifiedId === currentVideo.video_id && !firstAction);
  const entryTarget = empty ? closeTarget : firstTarget;
  useEffect(() => {
    if (!shown || !entryTarget || focusedView === view) return;
    return restoreFocus(() => entryTarget, requestTvFocus);
  }, [shown, entryTarget, view, focusedView]);
  // Keep the sheet stable across submenus while fitting the available actions.
  const panelHeight = Math.min(height - 120, Math.max(520, (168 + mainItems.length * 70) * Math.max(1, fontScale)));

  return (
    <Modal animationType="none" onRequestClose={goBack} onShow={() => setShown(true)} transparent visible>
      <TvFocusScope style={styles.fill}>
      <TVFocusGuideView accessibilityViewIsModal autoFocus destinations={entryTarget ? [entryTarget] : undefined} trapFocusDown trapFocusLeft trapFocusRight trapFocusUp style={styles.overlay}>
        <TvScreenTransition surface="glass" radius={36} style={[styles.panel, { height: panelHeight }]}>
          <View style={styles.videoSummary}>
            <View style={styles.thumbnailFrame}>
              {currentVideo.thumbnail ? <Image source={imageSourceWithHeaders(api.thumbnailSource(currentVideo.thumbnail))} resizeMode="cover" style={styles.thumbnail} /> : null}
              {formatVideoDuration(currentVideo.duration) ? <View style={styles.duration}><Text style={styles.durationText}>{formatVideoDuration(currentVideo.duration)}</Text></View> : null}
            </View>
            <Text numberOfLines={3} style={styles.videoTitle}>{currentVideo.title}</Text>
            <Text numberOfLines={1} style={styles.channel}>{currentVideo.channel_title}</Text>
          </View>

          <View style={styles.menuPanel}>
            <View style={styles.menuHeading}><Text accessibilityRole="header" style={styles.eyebrow}>{view === "actions" ? t("videoActions") : view === "schedule" ? t("scheduleVideo") : t("addToPlaylist")}</Text><TvCloseButton ref={setCloseTarget} t={t} variant="ghost" focusable={focusedView === view || empty} disabled={busy !== null} onPress={close} /></View>
            <View style={styles.choices} onFocus={() => setFocusedView(view)}>
            {verifiedId !== currentVideo.video_id ? <View style={styles.loading}>
              {metadataError ? <><Text style={styles.error}>{t("videoLoadError")}</Text><TvButton ref={setFirstTarget} label={t("tryAgain")} onPress={() => { setFocusedView(null); setMetadataRequest((request) => request + 1); }} /></>
                : <TvLoadingMark accessibilityLabel={t("loadingVideo")} />}
            </View> : view === "actions" ? (
              <FlatList
                key="actions"
                data={mainItems}
                contentContainerStyle={styles.actionList}
                keyExtractor={(item) => item}
                renderItem={({ item }) => item === "channel" ? (
                  <TvListButton
                    ref={item === firstAction ? setFirstTarget : undefined}
                    deferPress
                    surface="filled"
                    label={t("goToChannel")}
                    hasTVPreferredFocus
                    accessibilityState={{ busy: busy !== null }}
                    onPress={() => {
                      if (busy) return;
                      onClose();
                      onOpenChannel(currentVideo.channel_id!);
                    }}
                  />
                ) : (
                  <TvListButton
                    ref={item === firstAction ? setFirstTarget : undefined}
                    deferPress={item === "sessionQueue" || item === "schedule" || item === "playlist"}
                    surface="filled"
                    label={actionLabel(item)}
                    hasTVPreferredFocus={item === firstAction}
                    indicator={item === "schedule" || item === "playlist" ? "chevron" : null}
                    destructive={item === "archive" || item === "remove"}
                    accessibilityState={{ busy: busy === item }}
                    disabled={item === "sessionQueue" && !queued && queue.items.length >= SESSION_QUEUE_LIMIT}
                    onPress={() => selectAction(item)}
                  />
                )}
                ItemSeparatorComponent={() => <View style={styles.actionSeparator} />}
                {...tvVerticalListPerformance}
              />
            ) : view === "schedule" ? (
              <FlatList
                key="schedule"
                data={scheduleItems}
                contentContainerStyle={styles.actionList}
                keyExtractor={(item) => item}
                renderItem={({ item, index }) => {
                  const option = scheduleBuckets.find(({ bucket }) => bucket === item)!;
                  const selected = currentVideo.status === "queued" && currentVideo.bucket === item;
                  return (
                    <TvListButton
                      ref={index === 0 ? setFirstTarget : undefined}
                      surface="filled"
                      label={t(option.label)}
                      detail={selected ? t("removeSchedule") : undefined}
                      indicator={selected ? "check" : null}
                      accessibilityState={{ selected, busy: busy === `schedule-${item}` }}
                      hasTVPreferredFocus={index === 0}
                      onPress={() => chooseSchedule(item)}
                    />
                  );
                }}
                ItemSeparatorComponent={() => <View style={styles.actionSeparator} />}
                {...tvVerticalListPerformance}
              />
            ) : playlists === null ? (
              <View style={styles.loading}>
                <TvLoadingMark accessibilityLabel={t("loadingPlaylists")} />
              </View>
            ) : playlists.length === 0 ? (
              <TvEmptyState compact icon="playlists" title={t("playlistsEmpty")} />
            ) : (
              <FlatList
                key="playlists"
                data={playlists}
                contentContainerStyle={styles.playlistList}
                keyExtractor={(playlist) => String(playlist.id)}
                renderItem={({ item, index }) => (
                  <TvListButton
                    ref={index === 0 ? setFirstTarget : undefined}
                    surface="filled"
                    label={item.name}
                    onPress={() => togglePlaylist(item, item.has_video !== 1)}
                    hasTVPreferredFocus={index === 0}
                    indicator={item.has_video === 1 ? "check" : null}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: item.has_video === 1, busy: busy === `playlist-${item.id}` }}
                  />
                )}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
                {...tvVerticalListPerformance}
              />
            )}
            </View>
            {busy ? <View style={styles.busy}><TvLoadingMark accessibilityLabel={t("savingAction")} size={28} /></View> : null}
            {error ? <Text style={styles.error}>{t("actionFailed")}</Text> : null}
          </View>
        </TvScreenTransition>
      </TVFocusGuideView>
      </TvFocusScope>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { flex: 1, backgroundColor: colors.modalScrim, alignItems: "center", justifyContent: "center", padding: 60 },
  panel: { flex: 0, width: "88%", maxWidth: 1200, padding: 32, borderRadius: 36, flexDirection: "row", gap: 20 },
  videoSummary: { width: "38%", paddingTop: 8 },
  thumbnailFrame: { width: "100%", aspectRatio: 16 / 9, borderRadius: 24, overflow: "hidden", backgroundColor: colors.surfaceRaised },
  thumbnail: { width: "100%", height: "100%", backgroundColor: colors.surfaceRaised },
  duration: { position: "absolute", right: 12, bottom: 12, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7, backgroundColor: "rgba(0,0,0,0.8)" },
  durationText: { color: colors.white, fontSize: typography.caption.fontSize, fontWeight: "800" },
  videoTitle: { color: colors.text, fontSize: 28, lineHeight: 35, fontWeight: "800", marginTop: 22 },
  channel: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, marginTop: 9 },
  menuPanel: { flex: 1, minWidth: 0, minHeight: 0 },
  menuHeading: { flexDirection: "row", alignItems: "center", gap: 12, paddingLeft: 38, paddingRight: 12, marginBottom: 16 },
  eyebrow: { color: colors.text, fontSize: 30, lineHeight: 38, fontWeight: "700", flex: 1 },
  choices: { flex: 1, minHeight: 0 },
  actionList: { paddingHorizontal: 12, paddingVertical: 10 },
  actionSeparator: { height: 4 },
  loading: { minHeight: 360, alignItems: "center", justifyContent: "center", gap: 24 },
  empty: { minHeight: 340, alignItems: "center", justifyContent: "center", gap: 22 },
  emptyText: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, textAlign: "center" },
  playlistList: { paddingHorizontal: 12, paddingVertical: 10 },
  separator: { height: 4 },
  busy: { position: "absolute", top: 5, right: 4 },
  error: { color: colors.danger, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "700", marginTop: 14 },
});
