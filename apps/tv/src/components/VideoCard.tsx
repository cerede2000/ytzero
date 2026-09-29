import { translator } from "../i18n";
import { TvLiveBadge } from "./TvLiveBadge";
import { useVideoPress } from "../useVideoPress";
import { useVideoFocusMemory } from "../focus";
import { forwardRef, memo, useCallback, useMemo, useState } from "react";
import { Animated, Image, Platform, Pressable, StyleSheet, Text, View, type FocusDestination } from "react-native";
import type { Language, Video } from "../types";
import { colors, typography } from "../theme";
import { motion, useReducedMotion, useTvScale } from "../motion";
import { formatVideoCardMetadata } from "../videoMetadata";
import { formatVideoDuration } from "../duration";
import { TvChannelIdentity } from "./TvChannelIdentity";
import { imageSourceWithHeaders } from "../imageSource";

type ImageSource = { uri: string; headers?: Record<string, string> };

type Props = {
  video: Video;
  width: number;
  thumbnailSource: ImageSource;
  channelSource?: ImageSource;
  nextFocusUp?: FocusDestination;
  nextFocusDown?: FocusDestination;
  language: Language;
  onFocusChange?: (focused: boolean) => void;
  onLongPress?: () => void;
  onPress: () => void;
  viewsLabel: string;
};

/** Keep image decoding and the native badge subtree out of focus-only renders. */
const VideoArtwork = memo(function VideoArtwork({
  source,
  language,
  liveStatus,
  duration,
  progress,
}: {
  source: ImageSource;
  language: Language;
  liveStatus: Video["live_status"];
  duration: string;
  progress: number;
}) {
  const progressStyle = useMemo(() => ({ width: `${progress}%` as `${number}%` }), [progress]);
  return <>
    {source.uri ? (
      <Image source={imageSourceWithHeaders(source)} style={styles.image} resizeMode="cover" />
    ) : (
      <View style={[styles.image, styles.placeholder]}><Text style={styles.placeholderText}>YT Zero</Text></View>
    )}
    {liveStatus === "live" ? <TvLiveBadge language={language} /> : null}
    {liveStatus !== "live" && duration ? <View style={styles.duration}><Text style={styles.durationText}>{duration}</Text></View> : null}
    {progress > 0 ? <View style={styles.progressTrack}><View style={[styles.progressFill, progressStyle]} /></View> : null}
  </>;
});

const VideoCopy = memo(function VideoCopy({ title, channelTitle, channelSource, metadata }: {
  title: string;
  channelTitle: string;
  channelSource?: ImageSource;
  metadata: string;
}) {
  return <View style={styles.copy}>
    <Text numberOfLines={2} style={styles.title}>{title}</Text>
    <TvChannelIdentity title={channelTitle} source={channelSource} style={styles.channel} />
    {metadata ? <Text numberOfLines={1} style={styles.meta}>{metadata}</Text> : null}
  </View>;
});

export const VideoCard = forwardRef<View, Props>(function VideoCard(
  { video, width, thumbnailSource, channelSource, nextFocusUp, nextFocusDown, language, onFocusChange, onLongPress, onPress, viewsLabel },
  ref,
) {
  const memory = useVideoFocusMemory(ref);
  const [focused, setFocused] = useState(false);
  const scale = useTvScale(focused, false, motion.cardScale);
  const reduced = useReducedMotion();
  const press = useVideoPress(
    () => { memory.remember(); onPress(); },
    onLongPress ? () => { memory.remember(); onLongPress(); } : undefined,
  );
  const imageHeight = Math.round(width * 9 / 16);
  const metadata = useMemo(
    () => formatVideoCardMetadata(video, language, viewsLabel),
    [language, video.published_at, video.views, viewsLabel],
  );
  const duration = useMemo(() => formatVideoDuration(video.duration), [video.duration]);
  const progress = video.watch_position && video.watch_duration
    ? Math.max(0, Math.min(100, video.watch_position / video.watch_duration * 100))
    : 0;

  const changeFocus = useCallback((next: boolean) => {
    setFocused(next);
    onFocusChange?.(next);
  }, [onFocusChange]);

  const translated = useMemo(() => translator(language), [language]);
  const accessibilityLabel = useMemo(() => (
    `${video.title}. ${video.channel_title}${video.live_status === "live" ? `. ${translated("liveBadge")}` : ""}`
  ), [translated, video.channel_title, video.live_status, video.title]);
  const accessibilityActions = useMemo(
    () => onLongPress ? [{ name: "showMenu" as const, label: translated("videoActions") }] : undefined,
    [onLongPress, translated],
  );
  const parallax = useMemo(() => Platform.OS === "ios" ? {
    enabled: !reduced,
    shiftDistanceX: 7,
    shiftDistanceY: 7,
    tiltAngle: 0.055,
    magnification: 1,
    pressMagnification: 0.97,
    pressDuration: 0.18,
  } : undefined, [reduced]);
  const handleFocus = useCallback(() => changeFocus(true), [changeFocus]);
  const handleBlur = useCallback(() => { press.cancel(); changeFocus(false); }, [changeFocus, press.cancel]);
  const handleAccessibilityAction = useCallback((event: { nativeEvent: { actionName: string } }) => {
    if (event.nativeEvent.actionName === "showMenu") { memory.remember(); onLongPress?.(); }
  }, [memory, onLongPress]);

  return (
    <Pressable
      ref={memory.ref}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={handleAccessibilityAction}
      nextFocusUp={nextFocusUp}
      nextFocusDown={nextFocusDown}
      delayLongPress={520}
      onFocus={handleFocus}
      onBlur={handleBlur}
      {...press.handlers}
      tvParallaxProperties={parallax}
      style={({ pressed }) => [styles.card, { width }, focused && styles.cardFocused, pressed && styles.cardPressed]}
    >
      <Animated.View
        renderToHardwareTextureAndroid
        shouldRasterizeIOS
        style={[styles.thumbnailLift, { width, height: imageHeight, transform: [{ scale }] }, focused && styles.thumbnailLiftFocused]}
      >
        <View style={styles.imageFrame}>
          <VideoArtwork source={thumbnailSource} language={language} liveStatus={video.live_status} duration={duration} progress={progress} />
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.focusRing, focused && styles.focusRingVisible]} />
        </View>
      </Animated.View>
      <VideoCopy title={video.title} channelTitle={video.channel_title} channelSource={channelSource} metadata={metadata} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { marginBottom: 32, backgroundColor: "transparent", borderRadius: 20 },
  cardFocused: { zIndex: 10 },
  focusRing: { borderWidth: 3, borderRadius: 20, borderColor: "transparent" },
  focusRingVisible: { borderColor: colors.white },
  cardPressed: { opacity: 0.84 },
  thumbnailLift: { borderRadius: 20, shadowColor: colors.black, shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 8 } },
  thumbnailLiftFocused: { shadowOpacity: 0.9, shadowRadius: 32, shadowOffset: { width: 0, height: 18 } },
  imageFrame: { width: "100%", height: "100%", borderRadius: 20, overflow: "hidden", backgroundColor: colors.surface },
  image: { width: "100%", height: "100%", backgroundColor: colors.surface },
  placeholder: { alignItems: "center", justifyContent: "center" },
  placeholderText: { color: colors.textMuted, fontSize: 24, fontWeight: "800" },
  copy: { minHeight: 110, paddingHorizontal: 5, paddingTop: 14, paddingBottom: 4 },
  title: { color: colors.text, fontSize: 25, lineHeight: 32, fontWeight: "600" },
  meta: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, marginTop: 6 },
  channel: { marginTop: 7 },
  duration: { position: "absolute", right: 9, bottom: 12, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: "rgba(0,0,0,0.78)" },
  durationText: { color: colors.white, fontSize: typography.caption.fontSize, fontWeight: "700" },
  progressTrack: { position: "absolute", left: 0, right: 0, bottom: 0, height: 6, backgroundColor: "rgba(255,255,255,0.24)" },
  progressFill: { height: "100%", backgroundColor: colors.accentStrong },
});
