import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Image, StyleSheet, Text, TVFocusGuideView, View, type FocusDestination, type ImageURISource } from "react-native";
import type { Translate } from "../i18n";
import type { Video } from "../types";
import { colors, typography } from "../theme";
import { useReducedMotion } from "../motion";
import { useVideoFocusMemory } from "../focus";
import { TvButton } from "./TvButton";
import { TvScreenTransition } from "./TvScreenTransition";
import { TvSurface } from "./TvSurface";
import { TvHorizontalList } from "./TvHorizontalList";
import { TvPressable } from "./TvPressable";
import { TvChannelIdentity } from "./TvChannelIdentity";
import { formatVideoDuration } from "../duration";
import { imageSourceWithHeaders } from "../imageSource";

const videoKey = (video: Video) => video.video_id;

export const TvFeaturedVideo = forwardRef<View, {
  videos: Video[]; height: number; t: Translate; active: boolean;
  thumbnailSource: (thumbnail: string) => ImageURISource;
  nextFocusUp?: FocusDestination; nextFocusDown?: FocusDestination;
  onOpen: (video: Video, play?: boolean) => void;
  onBackdropChange: (thumbnail: string) => void;
  onThumbnailsTarget: (target: View | null) => void;
}>(function TvFeaturedVideo({ videos, height, t, active, thumbnailSource, nextFocusUp, nextFocusDown, onOpen, onBackdropChange, onThumbnailsTarget }, ref) {
  const [selectedId, setSelectedId] = useState(videos[0]?.video_id);
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [playTarget, setPlayTarget] = useState<View | null>(null);
  const [thumbnailTarget, setThumbnailTarget] = useState<View | null>(null);
  const interactionLocks = useRef(new Set<string>());
  const rotationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduced = useReducedMotion();
  const index = Math.max(0, videos.findIndex((video) => video.video_id === selectedId));
  const video = videos[index];
  const persistentRenderIndices = useMemo(() => [index], [index]);
  const setPlayRef = useCallback((target: View | null) => {
    setPlayTarget(target);
    if (typeof ref === "function") ref(target); else if (ref) ref.current = target;
  }, [ref]);
  const playMemory = useVideoFocusMemory(setPlayRef);
  const detailsMemory = useVideoFocusMemory(null);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setForeground(state === "active"));
    return () => subscription.remove();
  }, []);
  useEffect(() => { onBackdropChange(video?.thumbnail ?? ""); }, [onBackdropChange, video?.thumbnail]);
  useEffect(() => () => onBackdropChange(""), [onBackdropChange]);
  const cancelRotation = useCallback(() => {
    if (rotationTimer.current !== null) clearTimeout(rotationTimer.current);
    rotationTimer.current = null;
  }, []);
  const scheduleRotation = useCallback(() => {
    cancelRotation();
    if (!active || !foreground || reduced || interactionLocks.current.size > 0 || videos.length < 2) return;
    rotationTimer.current = setTimeout(() => {
      rotationTimer.current = null;
      setSelectedId(videos[(index + 1) % videos.length]!.video_id);
    }, 8000);
  }, [active, cancelRotation, foreground, index, reduced, videos]);
  useEffect(() => {
    scheduleRotation();
    return cancelRotation;
  }, [cancelRotation, scheduleRotation]);
  const setInteraction = useCallback((key: string, focused: boolean) => {
    if (focused) {
      interactionLocks.current.add(key);
      cancelRotation();
    } else {
      interactionLocks.current.delete(key);
      scheduleRotation();
    }
  }, [cancelRotation, scheduleRotation]);
  if (!video) return null;
  const controlFocus = (key: string) => ({
    onFocus: () => setInteraction(`control:${key}`, true),
    onBlur: () => setInteraction(`control:${key}`, false),
  });
  const step = (delta: number) => setSelectedId(videos[(index + delta + videos.length) % videos.length]!.video_id);
  return <>
    <View style={[styles.hero, { minHeight: height }]}>
      <TvScreenTransition key={video.video_id} style={styles.copy} fade>
        <Text style={styles.eyebrow}>{t("navWatchlist")}</Text>
        <Text accessibilityRole="header" numberOfLines={3} style={styles.title}>{video.title}</Text>
        <TvChannelIdentity title={video.channel_title} source={thumbnailSource(video.channel_thumbnail ?? "")}
          size={30} style={{ marginTop: 16 }} textStyle={styles.metadata} detail={formatVideoDuration(video.duration)} />
        {video.description ? <Text numberOfLines={2} style={styles.description}>{video.description}</Text> : null}
      </TvScreenTransition>
      <TVFocusGuideView autoFocus style={styles.controls}>
        <TvButton {...controlFocus("play")} ref={playMemory.ref} deferPress label={t("playVideo")} icon="play" variant="primary"
          nextFocusUp={nextFocusUp} nextFocusDown={thumbnailTarget ?? nextFocusDown} onPress={() => { playMemory.remember(); onOpen(video, true); }} />
        <TvButton {...controlFocus("details")} ref={detailsMemory.ref} deferPress label={t("videoDetails")} nextFocusUp={nextFocusUp} nextFocusDown={thumbnailTarget ?? nextFocusDown} onPress={() => { detailsMemory.remember(); onOpen(video, false); }} />
        {videos.length > 1 ? <View style={styles.pagination}>
          <TvSurface radius={37}>
          <TvButton {...controlFocus("previous")} variant="ghost" style={styles.arrow} label="" icon="left" accessibilityLabel={t("previousSlide")} nextFocusUp={nextFocusUp} nextFocusDown={thumbnailTarget ?? nextFocusDown} onPress={() => step(-1)} />
          <Text style={styles.counter}>{index + 1} / {videos.length}</Text>
          <TvButton {...controlFocus("next")} variant="ghost" style={styles.arrow} label="" icon="right" accessibilityLabel={t("nextSlide")} nextFocusUp={nextFocusUp} nextFocusDown={thumbnailTarget ?? nextFocusDown} onPress={() => step(1)} />
          </TvSurface>
        </View> : null}
      </TVFocusGuideView>
    </View>
    <TVFocusGuideView ref={onThumbnailsTarget} autoFocus style={styles.strip}>
      <TvHorizontalList data={videos} estimatedItemExtent={224} itemExtent={224} persistentRenderIndices={persistentRenderIndices}
        contentContainerStyle={styles.thumbnails} keyExtractor={videoKey}
        renderItem={({ item, index: itemIndex }) => <FeaturedThumbnail ref={itemIndex === 0 ? setThumbnailTarget : undefined}
          video={item} source={thumbnailSource(item.thumbnail)} selected={item.video_id === video.video_id}
          nextFocusUp={playTarget ?? nextFocusUp} nextFocusDown={nextFocusDown}
          onFocus={() => { setInteraction(`thumbnail:${item.video_id}`, true); setSelectedId(item.video_id); }}
          onBlur={() => setInteraction(`thumbnail:${item.video_id}`, false)} onPress={() => onOpen(item)} />}
      />
    </TVFocusGuideView>
  </>;
});

const FeaturedThumbnail = forwardRef<View, { video: Video; source: ImageURISource; selected: boolean; nextFocusUp?: FocusDestination; nextFocusDown?: FocusDestination; onFocus: () => void; onBlur: () => void; onPress: () => void }>(function FeaturedThumbnail({ video, source, selected, nextFocusUp, nextFocusDown, onFocus, onBlur, onPress }, ref) {
  const memory = useVideoFocusMemory(ref);
  return <TvPressable ref={memory.ref} deferPress focusScale={1.04} accessibilityRole="button" accessibilityLabel={video.title} accessibilityState={{ selected }}
    nextFocusUp={nextFocusUp} nextFocusDown={nextFocusDown} onPress={() => { memory.remember(); onPress(); }}
    onFocus={onFocus} onBlur={onBlur}
    style={({ focused }) => [styles.thumbnail, selected && styles.selectedThumbnail, focused && styles.focusedThumbnail]}>
    <Image source={imageSourceWithHeaders(source)} resizeMode="contain" style={styles.image} />
  </TvPressable>;
});
const styles = StyleSheet.create({
  hero: { justifyContent: "flex-end", alignItems: "flex-start", paddingTop: 90, paddingBottom: 26, paddingHorizontal: 20 },
  copy: { flex: 0, maxWidth: 980 },
  eyebrow: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "600", marginBottom: 12 },
  title: { color: colors.text, fontSize: 54, lineHeight: 62, fontWeight: "700", letterSpacing: -1.5 },
  metadata: { color: colors.text, fontSize: typography.caption.fontSize, lineHeight: 30 },
  description: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: 30, marginTop: 12, maxWidth: 850 },
  controls: { width: "100%", flexDirection: "row", alignItems: "center", gap: 16, marginTop: 24 },
  pagination: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 4, padding: 4 },
  arrow: { width: 66, paddingHorizontal: 0 },
  counter: { color: colors.text, paddingHorizontal: 8, fontSize: typography.caption.fontSize, fontVariant: ["tabular-nums"], minWidth: 82, textAlign: "center" },
  strip: { width: "100%", marginBottom: 28 },
  thumbnails: { paddingHorizontal: 20, paddingVertical: 10, gap: 16 },
  thumbnail: { width: 208, height: 117, borderRadius: 14, borderWidth: 3, borderColor: "transparent", backgroundColor: "#101115", overflow: "hidden" },
  selectedThumbnail: { borderColor: "rgba(255,255,255,0.55)" },
  focusedThumbnail: { borderColor: colors.white },
  image: { width: "100%", height: "100%" },
});
