import { translator } from "../i18n";
import { TvLiveBadge } from "./TvLiveBadge";
import { useVideoPress } from "../useVideoPress";
import { useVideoFocusMemory } from "../focus";
import { forwardRef, memo, useCallback, useEffect, useMemo, useState } from "react";
import { Animated, Image, Platform, Pressable, StyleSheet, Text, View, type FocusDestination } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { Language, Video } from "../types";
import { colors, typography } from "../theme";
import { motion, useIncreasedContrast, useReducedMotion, useTvScale } from "../motion";
import { formatVideoCardMetadata } from "../videoMetadata";
import { formatVideoDuration } from "../duration";
import { TvChannelIdentity } from "./TvChannelIdentity";
import { imageSourceWithHeaders } from "../imageSource";

type ImageSource = { uri: string; headers?: Record<string, string> };

type Props = {
  video: Video;
  width: number;
  portraitSource: ImageSource;
  fallbackSource: ImageSource;
  channelSource?: ImageSource;
  language: Language;
  nextFocusUp?: FocusDestination;
  nextFocusDown?: FocusDestination;
  onFocusChange?: (focused: boolean) => void;
  onLongPress?: () => void;
  onPress: () => void;
  viewsLabel: string;
};

const ShortShade = memo(function ShortShade({ contrast }: { contrast: boolean }) {
  return <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
    <Defs>
      <LinearGradient id="short-shade" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0.38" stopColor={colors.black} stopOpacity="0" />
        <Stop offset="0.58" stopColor={colors.black} stopOpacity={contrast ? "0.92" : "0.78"} />
        <Stop offset="1" stopColor={colors.black} stopOpacity="0.94" />
      </LinearGradient>
    </Defs>
    <Rect width="100%" height="100%" fill="url(#short-shade)" />
  </Svg>;
});

/** The image and SVG stay mounted while focus moves between cards. */
const ShortArtwork = memo(function ShortArtwork({
  videoId,
  watched,
  portraitSource,
  fallbackSource,
  contrast,
}: {
  videoId: string;
  watched: number | null;
  portraitSource: ImageSource;
  fallbackSource: ImageSource;
  contrast: boolean;
}) {
  const [portraitFailed, setPortraitFailed] = useState(false);
  useEffect(() => setPortraitFailed(false), [portraitSource.uri, videoId]);
  const source = portraitFailed ? fallbackSource : portraitSource;
  return <>
    {source.uri ? (
      <Image
        source={imageSourceWithHeaders(source)}
        resizeMode="cover"
        style={[styles.image, watched === 1 && styles.imageWatched]}
        onError={!portraitFailed ? () => setPortraitFailed(true) : undefined}
      />
    ) : (
      <View style={[styles.image, styles.placeholder]}><Text style={styles.placeholderText}>YT Zero</Text></View>
    )}
    <ShortShade contrast={contrast} />
  </>;
});

const ShortCopy = memo(function ShortCopy({ title, channelTitle, channelSource, metadata }: {
  title: string;
  channelTitle: string;
  channelSource?: ImageSource;
  metadata: string;
}) {
  return <View style={styles.copy}>
    <Text numberOfLines={3} style={styles.title}>{title}</Text>
    <TvChannelIdentity title={channelTitle} source={channelSource} size={20} textStyle={styles.channel} style={styles.channelRow} />
    {metadata ? <Text numberOfLines={1} style={styles.meta}>{metadata}</Text> : null}
  </View>;
});

const ShortOverlays = memo(function ShortOverlays({ language, liveStatus, duration, progress }: {
  language: Language;
  liveStatus: Video["live_status"];
  duration: string;
  progress: number;
}) {
  const progressStyle = useMemo(() => ({ width: `${progress}%` as `${number}%` }), [progress]);
  return <>
    {liveStatus === "live" ? <TvLiveBadge language={language} /> : null}
    {liveStatus !== "live" && duration ? <View style={styles.duration}><Text style={styles.durationText}>{duration}</Text></View> : null}
    {progress > 0 ? <View style={styles.progressTrack}><View style={[styles.progressFill, progressStyle]} /></View> : null}
  </>;
});

export const TvShortCard = forwardRef<View, Props>(function TvShortCard(
  { video, width, portraitSource, fallbackSource, channelSource, language, nextFocusUp, nextFocusDown, onFocusChange, onLongPress, onPress, viewsLabel },
  ref,
) {
  const memory = useVideoFocusMemory(ref);
  const [focused, setFocused] = useState(false);
  const scale = useTvScale(focused, false, motion.cardScale);
  const reduced = useReducedMotion();
  const contrast = useIncreasedContrast();
  const press = useVideoPress(
    () => { memory.remember(); onPress(); },
    onLongPress ? () => { memory.remember(); onLongPress(); } : undefined,
  );
  const height = Math.round(width * 16 / 9);
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
    shiftDistanceX: 6,
    shiftDistanceY: 8,
    tiltAngle: 0.045,
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
      style={({ pressed }) => [styles.card, { width, height }, focused && styles.cardFocused, pressed && styles.cardPressed]}
    >
      <Animated.View
        renderToHardwareTextureAndroid
        shouldRasterizeIOS
        style={[styles.lift, { transform: [{ scale }] }, focused && styles.liftFocused]}
      >
        <View style={styles.imageFrame}>
          <ShortArtwork videoId={video.video_id} watched={video.watched} portraitSource={portraitSource} fallbackSource={fallbackSource} contrast={contrast} />
          <ShortCopy title={video.title} channelTitle={video.channel_title} channelSource={channelSource} metadata={metadata} />
          <ShortOverlays language={language} liveStatus={video.live_status} duration={duration} progress={progress} />
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.focusRing, focused && styles.focusRingVisible]} />
        </View>
      </Animated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { marginBottom: 30, borderRadius: 24, backgroundColor: "transparent" },
  cardFocused: { zIndex: 10 },
  focusRing: { borderWidth: 3, borderRadius: 24, borderColor: "transparent" },
  focusRingVisible: { borderColor: colors.white },
  cardPressed: { opacity: 0.84 },
  lift: { width: "100%", height: "100%", borderRadius: 24, backgroundColor: colors.surface, shadowColor: colors.black, shadowOpacity: 0.34, shadowRadius: 14, shadowOffset: { width: 0, height: 9 } },
  liftFocused: { shadowOpacity: 0.92, shadowRadius: 34, shadowOffset: { width: 0, height: 20 } },
  imageFrame: { width: "100%", height: "100%", borderRadius: 24, overflow: "hidden", backgroundColor: colors.surface },
  image: { width: "100%", height: "100%", backgroundColor: colors.surface },
  imageWatched: { opacity: 0.58 },
  placeholder: { alignItems: "center", justifyContent: "center" },
  placeholderText: { color: colors.textMuted, fontSize: typography.caption.fontSize, fontWeight: "800" },
  copy: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 50, paddingBottom: 17 },
  title: { color: colors.white, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "700", textShadowColor: "rgba(0,0,0,0.7)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  meta: { color: "rgba(255,255,255,0.76)", fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "600", marginTop: 6 },
  channel: { color: "rgba(255,255,255,0.72)", fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "600" },
  channelRow: { marginTop: 4 },
  duration: { position: "absolute", right: 10, top: 12, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6, backgroundColor: "rgba(0,0,0,0.8)" },
  durationText: { color: colors.white, fontSize: typography.caption.fontSize, fontWeight: "800" },
  progressTrack: { position: "absolute", left: 0, right: 0, bottom: 0, height: 6, backgroundColor: "rgba(255,255,255,0.2)" },
  progressFill: { height: "100%", backgroundColor: colors.accentStrong },
});
