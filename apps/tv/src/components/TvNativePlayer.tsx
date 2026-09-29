import { useEffect, useMemo, useRef, useState } from "react";
import { createVideoPlayer, VideoView } from "expo-video";
import { AppState, Modal, StyleSheet, Text, View } from "react-native";
import { ApiError, type YtZeroApi } from "../api";
import type { Translate } from "../i18n";
import { PlaybackProgress, validPlaybackPosition, type PlaybackResult } from "../playback";
import { PlaybackBuffer, type BufferedPlayback } from "../playbackBuffer";
import type { Video } from "../types";
import { colors, typography, screenPadding } from "../theme";
import { TvBackButton } from "./TvBackButton";
import { TvButton } from "./TvButton";
import { TvLoadingMark } from "./TvLoadingMark";
import { dismissPlayer, playPlayer, pausePlayer, seekPlayer, setPlayerMetadata, isPlayerAttached, unloadPlayer } from "../playerControl";
import { waitForPlayerAttachment } from "../playerAttachment";
import { reportPlaybackDiagnostic } from "../reportPlaybackDiagnostic";
import type { PlaybackStage } from "../playbackDiagnostics";
import { clearPlayerQueue, subscribePlayerQueue, updatePlayerQueue } from "../playerQueueControl";
import { shortsNavigation, type PlaybackQueueContext } from "../playbackQueue";
import { focusWhenReady, suspendBackgroundFocusRedirects } from "../focus";
import { TvFocusScope } from "./TvFocusScope";
import { useTvModalBack } from "../useTvModalBack";
import { TvModalCanvas } from "./TvModalCanvas";

type Props = {
  api: YtZeroApi; video: Video; startPosition: number; incognito: boolean; isChild: boolean; t: Translate;
  queueVideos: Video[]; nextVideo: Video | null; previousVideo: Video | null; queueLoading: boolean;
  advanceOnEnd: boolean; queueContext: PlaybackQueueContext | null;
  onAdvance: (video: Video) => void;
  onProgress: (video: Video, result: PlaybackResult) => void;
  onClose: (result: PlaybackResult, next?: Video, playedVideo?: Video) => void;
};
type Failure = "playbackError" | "playbackUnavailable" | "playbackRestricted" | "playbackSessionExpired";
type Session = {
  entry: BufferedPlayback; progress: PlaybackProgress;
  position: { position: number; duration: number }; startPosition: number;
  didPlay: boolean; completed: boolean; history: Promise<boolean> | null; finished: Promise<PlaybackResult> | null;
};
function playbackFailure(error: unknown): Failure {
  return error instanceof ApiError ? error.status === 403 ? "playbackRestricted" : error.status === 401 ? "playbackSessionExpired"
    : [404, 409, 503].includes(error.status) ? "playbackUnavailable" : "playbackError" : "playbackError";
}

/** One modal and one AVKit controller for the entire Shorts session. */
export function TvNativePlayer(props: Props) {
  const { api, video, startPosition, incognito, isChild, t, nextVideo, previousVideo, queueVideos, queueLoading } = props;
  const latest = useRef(props);
  latest.current = props;
  const view = useRef<VideoView>(null);
  const retryButton = useRef<View>(null);
  const detailsButton = useRef<View>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [panelFocused, setPanelFocused] = useState(false);
  const initial = useRef({ video, startPosition });
  const session = useRef<Session | null>(null);
  const alive = useRef(true);
  const closing = useRef(false);
  const switching = useRef(false);
  const transitionLease = useRef<(() => void) | null>(null);
  const activating = useRef<BufferedPlayback | null>(null);
  const fullscreen = useRef(false);
  const modalShown = useRef(false);
  const showDetails = useRef(false);
  const nextSelection = useRef<Video | undefined>(undefined);
  const failure = useRef<Failure | null>(null);
  const pendingSaves = useRef(new Set<Promise<PlaybackResult>>());
  const finishedSessions = useRef(new Map<string, Promise<PlaybackResult>>());
  const saveFailed = useRef(false);
  const handleFailure = useRef<(entry: BufferedPlayback, error: unknown) => void>(() => {});
  const [active, setActive] = useState<BufferedPlayback | null>(null);
  const [ready, setReady] = useState(false);
  const [presented, setPresented] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [switchingVideo, setSwitchingVideo] = useState(false);
  const buffer = useMemo(() => new PlaybackBuffer(api, () => {
    const player = createVideoPlayer(null);
    player.timeUpdateEventInterval = 1;
    player.staysActiveInBackground = false;
    player.audioMixingMode = "doNotMix";
    player.bufferOptions = { preferredForwardBufferDuration: 5, maxBufferBytes: 8 * 1024 * 1024 };
    return player;
  }, seekPlayer, (entry, cause) => handleFailure.current(entry, cause), unloadPlayer, { play: playPlayer, pause: pausePlayer }), [api]);

  const endTransition = () => {
    transitionLease.current?.();
    transitionLease.current = null;
    switching.current = false;
    setSwitchingVideo(false);
  };

  const begin = (entry: BufferedPlayback) => {
    const position = entry.player.status === "readyToPlay" ? entry.player.currentTime : entry.initialPosition;
    // Swiping back quickly must not let a slow save from the previous visit
    // overwrite the newer visit's progress or completion.
    const previousSave = finishedSessions.current.get(entry.video.video_id);
    session.current = {
      entry, startPosition: position, position: { position, duration: 0 }, didPlay: false, completed: false, history: null, finished: null,
      progress: new PlaybackProgress(entry.video.live_status !== "live" && (!incognito || isChild),
        async (value) => { await previousSave; return api.savePlaybackProgress(entry.video.video_id, value); },
        async () => { await previousSave; return api.markWatched(entry.video.video_id); }),
    };
    setReady(false);
    setActive(entry);
    void entry.ready.then(async () => {
      if (!alive.current || session.current?.entry !== entry || closing.current || failure.current) return;
      // AVKit reads AVPlayerItem.externalMetadata; expo-video's source metadata
      // only populates its separate, opt-in Now Playing notification manager.
      try { await setPlayerMetadata(entry.player, entry.video.title, entry.video.channel_title ?? ""); }
      catch (cause) { void reportPlaybackDiagnostic(entry.player, "metadata", cause); }
      if (alive.current && session.current?.entry === entry && !closing.current && !failure.current) setReady(true);
    }).catch((cause) => { if (session.current?.entry === entry) fail(playbackFailure(cause), "load", cause); });
  };

  const finish = (current: Session): Promise<PlaybackResult> => {
    if (current.finished) return current.finished;
    if (current.didPlay) current.position = { position: current.entry.player.currentTime, duration: current.entry.player.duration };
    const value = current.entry.video.live_status === "live" ? { position: 0, duration: 0 }
      : current.didPlay ? current.position : { position: current.startPosition, duration: 0 };
    // A retained previous player resumes from its last frame, or restarts if it ended.
    current.entry.video = { ...current.entry.video, watch_position: value.position, watch_duration: value.duration,
      watched: current.completed ? 1 : current.entry.video.watched };
    current.finished = Promise.all([current.progress.finish(value, current.completed), current.history]).then(([failed, historyFailed]) => {
      const result = { ...value, completed: current.completed, saveFailed: failed || Boolean(historyFailed) };
      saveFailed.current ||= result.saveFailed;
      return result;
    });
    const pending = current.finished;
    const videoId = current.entry.video.video_id;
    finishedSessions.current.set(videoId, pending);
    pendingSaves.current.add(pending);
    const settled = () => {
      pendingSaves.current.delete(pending);
      // A newer visit may already have installed its own save chain for this
      // video. Only release the entry owned by the promise that just settled.
      if (finishedSessions.current.get(videoId) === pending) finishedSessions.current.delete(videoId);
    };
    void pending.then(settled, settled);
    return pending;
  };

  const close = async () => {
    if (closing.current) return;
    closing.current = true;
    setDismissing(true);
    endTransition();
    const current = session.current;
    if (current) void reportPlaybackDiagnostic(current.entry.player, "closed");
    await buffer.pause().catch(() => {});
    const result = current ? await finish(current) : { position: startPosition, duration: 0, completed: false, saveFailed: false };
    await Promise.all(pendingSaves.current);
    if (alive.current) latest.current.onClose({ ...result, showDetails: showDetails.current, saveFailed: result.saveFailed || saveFailed.current }, nextSelection.current, current?.entry.video);
  };

  const exitPresentation = async () => {
    try {
      if (session.current && await dismissPlayer(session.current.entry.player)) {
        fullscreen.current = false;
        setPresented(false);
        if (!failure.current) void close();
      } else if (fullscreen.current) await view.current?.exitFullscreen();
      else if (!failure.current) void close();
    } catch (cause) { fail("playbackError", "dismiss", cause); }
  };

  const fail = (reason: Failure, stage: PlaybackStage = "load", cause: unknown = new Error(reason)) => {
    if (!alive.current || closing.current || failure.current) return;
    if (session.current) void reportPlaybackDiagnostic(session.current.entry.player, stage, cause);
    failure.current = reason;
    endTransition();
    nextSelection.current = undefined;
    setError(reason);
    void buffer.pause().catch(() => {});
    if (fullscreen.current) void exitPresentation();
  };
  handleFailure.current = (entry, cause) => { if (session.current?.entry === entry) fail(playbackFailure(cause), "load", cause); };

  const advance = async (target: Video) => {
    const current = session.current;
    if (!current || closing.current || switching.current || failure.current || target.video_id === current.entry.video.video_id) return;
    switching.current = true;
    setSwitchingVideo(true);
    transitionLease.current = buffer.protect([current.entry.video.video_id, target.video_id]);
    if (current.entry.video.is_short !== 1 || target.is_short !== 1) {
      nextSelection.current = target;
      await exitPresentation();
      return;
    }
    const wasPlaying = current.entry.player.playing;
    let next: BufferedPlayback | undefined;
    try {
      await buffer.pause();
      // Keep the paused frame until the neighbour is ready. Never dismiss AVKit
      // or remove the React Native Modal/VideoView during a Shorts transition.
      buffer.retain([current.entry.video.video_id, target.video_id]);
      next = buffer.prepare(target);
      try { await next.ready; }
      catch {
        if (!alive.current || closing.current || failure.current) return;
        // A speculative HTTP failure must not poison the chosen item forever.
        // Retry once with a fresh native item and scoped authorization.
        next = buffer.prepare(target);
        await next.ready;
      }
      if (!alive.current || closing.current || failure.current || session.current !== current) return;
      if (isChild && (await api.playbackRestriction()).locked) { fail("playbackRestricted"); return; }
      if (!alive.current || closing.current || failure.current) return;
      if (next.video.watched === 1) await seekPlayer(next.player, 0);
      if (!alive.current || closing.current || failure.current) return;
      if (next.error) throw next.error;
      const saving = finish(current);
      const playedVideo = current.entry.video;
      void saving.then((result) => { if (alive.current) latest.current.onProgress(playedVideo, result); });
      begin(next);
      latest.current.onAdvance(next.video);
      // The guard is released after the player prop commits and playback starts.
    } catch (cause) {
      if (!alive.current || closing.current || failure.current) return;
      const reason = playbackFailure(cause);
      if (reason === "playbackRestricted" || reason === "playbackSessionExpired" || session.current !== current) {
        fail(reason, "load", cause);
        return;
      }
      if (next) void reportPlaybackDiagnostic(next.player, "load", cause);
      // Keep the current player and re-arm remote input when a neighbour fails.
      // An ended Short stays paused, avoiding an automatic retry loop.
      endTransition();
      buffer.retain([current.entry.video.video_id]);
      if (wasPlaying && !current.completed) void buffer.play(current.entry).catch((error) => fail("playbackError", "present", error));
    }
  };

  useEffect(() => {
    alive.current = true;
    const releaseFocus = suspendBackgroundFocusRedirects();
    return () => {
      alive.current = false;
      transitionLease.current?.();
      transitionLease.current = null;
      const current = session.current;
      if (current) {
        void clearPlayerQueue(current.entry.player).catch(() => {});
        void finish(current);
      }
      buffer.dispose();
      releaseFocus();
    };
  }, [buffer]);

  useEffect(() => {
    failure.current = null;
    setError(null);
    const previous = session.current;
    const target = previous?.entry.video ?? initial.current.video;
    const position = previous?.didPlay ? previous.position.position : previous?.startPosition ?? initial.current.startPosition;
    if (previous) { void finish(previous); buffer.retain([]); }
    begin(buffer.prepare(target, position));
  }, [attempt, buffer]);

  const present = () => {
    if (!modalShown.current || !ready || !active || closing.current || failure.current || activating.current === active) return;
    activating.current = active;
    const current = () => alive.current && !closing.current && !failure.current && session.current?.entry === active;
    void (async () => {
      if (!fullscreen.current) {
        fullscreen.current = true;
        await view.current?.enterFullscreen();
        if (!current()) return;
        setPresented(true);
      }
      // An inline expo VideoView is not a child view controller on tvOS;
      // AVKit becomes discoverable only after the first presentation.
      if (!await waitForPlayerAttachment(() => isPlayerAttached(active.player), current)) return;
      const started = await buffer.play(active);
      if (started && current()) endTransition();
    })().catch((cause) => { if (current()) fail("playbackError", "present", cause); })
      .finally(() => { if (activating.current === active) activating.current = null; });
  };
  useEffect(() => { present(); }, [active, ready]);
  useTvModalBack(!presented, () => { if (fullscreen.current) void exitPresentation(); else void close(); }, true);

  useEffect(() => {
    if (!active) return;
    const player = active.player;
    const subscriptions = [
      player.addListener("timeUpdate", ({ currentTime }) => {
        const current = session.current;
        if (!current || current.entry !== active || current.finished) return;
        if (player.playing && currentTime > 0) {
          if (!current.didPlay) void reportPlaybackDiagnostic(player, "playing");
          current.didPlay = true;
          if ((!incognito || isChild) && !current.history) current.history = api.recordPlayback(active.video.video_id, latest.current.queueContext).then(() => false, () => true);
        }
        current.position = { position: currentTime, duration: player.duration };
      }),
      player.addListener("playingChange", ({ isPlaying }) => {
        const current = session.current;
        if (current?.entry === active && !isPlaying && current.didPlay && !current.finished) current.progress.update(current.position);
      }),
      player.addListener("playToEnd", () => {
        const current = session.current;
        if (!current || current.entry !== active || current.finished || switching.current) return;
        current.completed = active.video.live_status !== "live";
        const next = latest.current.advanceOnEnd ? latest.current.nextVideo : null;
        if (next) void advance(next);
        else if (fullscreen.current) void exitPresentation(); else void close();
      }),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [active, api, incognito, isChild]);

  useEffect(() => {
    const subscription = subscribePlayerQueue(({ currentId, videoId, action }) => {
      if (currentId !== session.current?.entry.video.video_id || closing.current || switching.current || failure.current) return;
      if (action === "details") { showDetails.current = true; void exitPresentation(); return; }
      const state = latest.current;
      const target = [...state.queueVideos, state.nextVideo, state.previousVideo].find((item) => item?.video_id === videoId);
      if (target) void advance(target);
    });
    return () => subscription.remove();
  }, [buffer]);

  useEffect(() => {
    if (!active || !ready || !presented || queueLoading || switchingVideo || switching.current || session.current?.entry !== active) return;
    const neighbours = active.video.is_short === 1 ? [nextVideo, previousVideo].filter((item): item is Video => item?.is_short === 1 && item.video_id !== active.video.video_id) : [];
    buffer.retain([active.video.video_id, ...neighbours.map((item) => item.video_id)]);
    neighbours.forEach((item) => buffer.prepare(item));
  }, [active, buffer, nextVideo, previousVideo, presented, queueLoading, ready, switchingVideo]);

  useEffect(() => {
    if (!presented || !active) return;
    let valid = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const queue = {
      currentId: active.video.video_id, nextId: nextVideo?.video_id ?? "", previousId: previousVideo?.video_id ?? "",
      navigationEnabled: ready && !switchingVideo && !queueLoading,
      shorts: shortsNavigation(active.video, nextVideo, previousVideo),
      items: queueVideos.map((item) => ({ id: item.video_id, title: item.title })),
      labels: { details: t("videoDetails"), queue: t("playQueue"), next: t("nextVideo"), previous: t("previousVideo") },
    };
    const install = async (remaining: number) => {
      const installed = await updatePlayerQueue(active.player, queue).catch(() => false);
      if (valid && !installed && remaining > 0) retry = setTimeout(() => void install(remaining - 1), 100);
    };
    void install(20);
    return () => { valid = false; clearTimeout(retry); };
  }, [active, nextVideo, presented, previousVideo, queueVideos, queueLoading, ready, switchingVideo, t]);

  useEffect(() => {
    let checking = false;
    const interval = setInterval(() => {
      const current = session.current;
      if (!current || closing.current || failure.current) return;
      if (current.entry.player.playing && current.didPlay && validPlaybackPosition(current.position)) current.progress.update(current.position);
      if (isChild && !checking) {
        checking = true;
        void api.playbackRestriction().then((status) => { if (alive.current && status.locked) fail("playbackRestricted"); })
          .catch((cause) => fail("playbackRestricted", "restriction", cause)).finally(() => { checking = false; });
      }
    }, 5000);
    const state = AppState.addEventListener("change", (value) => {
      const current = session.current;
      if (value === "background" && current) {
        void buffer.pause().catch(() => {});
        if (current.didPlay) current.progress.update(current.position);
        buffer.retain([current.entry.video.video_id]);
      }
    });
    return () => { clearInterval(interval); state.remove(); };
  }, [api, buffer, isChild]);

  useEffect(() => {
    // When the item is ready, the earlier present effect is handing focus to
    // AVKit in this same commit. Stop any loading-panel focus retries instead
    // of competing with the native fullscreen controller.
    if (!modalVisible || presented || dismissing || (!error && active && ready)) return;
    const target = error && error !== "playbackRestricted" ? retryButton.current : detailsButton.current;
    if (target) return focusWhenReady(target, () => setPanelFocused(true));
  }, [active, dismissing, error, modalVisible, presented, ready]);

  const currentVideo = active?.video ?? video;
  return (
    <Modal visible animationType="none" onShow={() => { modalShown.current = true; setModalVisible(true); present(); }} onRequestClose={() => { if (fullscreen.current) void exitPresentation(); else void close(); }}>
      <TvFocusScope style={styles.screen}>
        <VideoView ref={view} player={active?.player ?? null} style={StyleSheet.absoluteFill} nativeControls contentFit="contain"
          fullscreenOptions={{ enable: true }} allowsPictureInPicture={false}
          onFullscreenExit={() => {
            fullscreen.current = false;
            setPresented(false);
            if (!failure.current) void close();
          }} />
        {!presented && !dismissing ? <TvModalCanvas><View style={styles.panel}>
          {!error ? <TvLoadingMark accessibilityLabel={t("preparingPlayback")} size={48} /> : null}
          <Text style={styles.eyebrow}>{error ? t("playbackErrorTitle") : t("preparingPlayback")}</Text>
          <Text accessibilityRole="header" numberOfLines={3} style={styles.title}>{currentVideo.title}</Text>
          <Text style={styles.description}>{error ? t(error) : currentVideo.channel_title}</Text>
          <View style={styles.actions}>
            <TvBackButton t={t} focusable={panelFocused} onPress={() => void close()} />
            <TvButton ref={detailsButton} deferPress label={t("videoDetails")} preferredFocus={!error || error === "playbackRestricted"} onFocus={() => setPanelFocused(true)} onPress={() => { showDetails.current = true; void close(); }} />
            {error && error !== "playbackRestricted" ? <TvButton ref={retryButton} label={t("tryAgain")} preferredFocus variant="primary" onPress={() => { switching.current = false; setAttempt((value) => value + 1); }} /> : null}
          </View>
        </View></TvModalCanvas> : null}
      </TvFocusScope>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.black },
  panel: { ...StyleSheet.absoluteFill, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: screenPadding, gap: 20 },
  eyebrow: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "600" },
  title: { maxWidth: 1060, textAlign: "center", color: colors.text, fontSize: 38, lineHeight: 48, fontWeight: "700" },
  description: { maxWidth: 960, color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: 32, textAlign: "center" },
  actions: { flexDirection: "row", gap: 20, marginTop: 16 },
});
