import { useVideoPress } from "../useVideoPress";
import { useVideoFocusMemory } from "../focus";
import { forwardRef, useState } from "react";
import { Animated, Image, Platform, Pressable, StyleSheet, Text, View, type FocusDestination } from "react-native";
import { formatBookmarkTime } from "../bookmarkTime";
import { formatVideoDuration } from "../duration";
import type { BookmarkVideo } from "../types";
import { colors, typography } from "../theme";
import { TvControlSurface } from "./TvSurface";
import { SidebarIcon } from "./SidebarIcon";
import { useReducedMotion, useTvScale } from "../motion";
import { imageSourceWithHeaders } from "../imageSource";

type Props = {
  bookmark: BookmarkVideo;
  dateLabel: string;
  emptyDescriptionLabel: string;
  actionsLabel: string;
  thumbnailSource: { uri: string; headers?: Record<string, string> };
  nextFocusUp?: FocusDestination;
  onFocusChange?: (focused: boolean) => void;
  onLongPress?: () => void;
  onPress: () => void;
};

export const BookmarkRow = forwardRef<View, Props>(function BookmarkRow(
  { bookmark, dateLabel, emptyDescriptionLabel, actionsLabel, thumbnailSource, nextFocusUp, onFocusChange, onLongPress, onPress },
  ref,
) {
  const memory = useVideoFocusMemory(ref);
  const [focused, setFocused] = useState(false);
  const scale = useTvScale(focused, false, 1.018);
  const reduced = useReducedMotion();
  const press = useVideoPress(
    () => { memory.remember(); onPress(); },
    onLongPress ? () => { memory.remember(); onLongPress(); } : undefined,
  );
  const time = formatBookmarkTime(bookmark.position_seconds);
  const duration = formatVideoDuration(bookmark.duration);
  const description = bookmark.bookmark_description.trim() || emptyDescriptionLabel;

  const changeFocus = (next: boolean) => {
    setFocused(next);
    onFocusChange?.(next);
  };

  return (
    <Animated.View style={[styles.lift, { transform: [{ scale }] }, focused && styles.liftFocused]}>
      <Pressable
        ref={memory.ref}
        accessibilityLabel={`${time}. ${description}. ${bookmark.title}. ${bookmark.channel_title}`}
        accessibilityRole="button"
        accessibilityActions={onLongPress ? [{ name: "showMenu", label: actionsLabel }] : undefined}
        onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === "showMenu") { memory.remember(); onLongPress?.(); } }}
        nextFocusUp={nextFocusUp}
        delayLongPress={520}
        onFocus={() => changeFocus(true)}
        onBlur={() => { press.cancel(); changeFocus(false); }}
        {...press.handlers}
        tvParallaxProperties={Platform.OS === "ios" ? {
          enabled: !reduced,
          shiftDistanceX: 4,
          shiftDistanceY: 3,
          tiltAngle: 0.025,
          magnification: 1.005,
          pressMagnification: 0.985,
          pressDuration: 0.16,
        } : undefined}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <TvControlSurface radius={28} focused={focused} />
        <View style={[styles.moment, focused && styles.momentFocused]}>
          <SidebarIcon name="bookmarks" color={colors.accentStrong} size={29} />
          <Text style={[styles.time, focused && styles.textFocused]}>{time}</Text>
        </View>

        <View style={styles.copy}>
          <Text numberOfLines={2} style={[styles.description, focused && styles.textFocused]}>{description}</Text>
          <Text numberOfLines={1} style={[styles.videoTitle, focused && styles.secondaryFocused]}>{bookmark.title}</Text>
          <Text numberOfLines={1} style={[styles.meta, focused && styles.secondaryFocused]}>
            {[bookmark.channel_title, dateLabel].filter(Boolean).join("  •  ")}
          </Text>
        </View>

        <View style={styles.thumbnailFrame}>
          {thumbnailSource.uri ? (
            <Image source={imageSourceWithHeaders(thumbnailSource)} resizeMode="cover" style={styles.thumbnail} />
          ) : (
            <View style={[styles.thumbnail, styles.placeholder]}><Text style={styles.placeholderText}>YT Zero</Text></View>
          )}
          {duration ? <View style={styles.duration}><Text style={styles.durationText}>{duration}</Text></View> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  lift: { borderRadius: 28 },
  liftFocused: { zIndex: 10, shadowColor: colors.black, shadowOpacity: 0.7, shadowRadius: 26, shadowOffset: { width: 0, height: 15 } },
  row: { minHeight: 166, padding: 14, borderRadius: 28, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", gap: 24 },
  rowPressed: { opacity: 0.8 },
  moment: { width: 142, alignSelf: "stretch", borderRadius: 20, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center", gap: 9 },
  momentFocused: { backgroundColor: "rgba(0,0,0,0.08)" },
  time: { color: colors.text, fontSize: 26, lineHeight: 31, fontWeight: "800", fontVariant: ["tabular-nums"] },
  copy: { flex: 1, minWidth: 0, paddingVertical: 8 },
  description: { color: colors.text, fontSize: 27, lineHeight: 33, fontWeight: "700", letterSpacing: -0.35 },
  videoTitle: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "600", marginTop: 10 },
  meta: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, marginTop: 5 },
  textFocused: { color: colors.text },
  secondaryFocused: { color: colors.text },
  thumbnailFrame: { width: 246, aspectRatio: 16 / 9, borderRadius: 18, overflow: "hidden", backgroundColor: colors.surfaceRaised },
  thumbnail: { width: "100%", height: "100%", backgroundColor: colors.surfaceRaised },
  placeholder: { alignItems: "center", justifyContent: "center" },
  placeholderText: { color: colors.textMuted, fontSize: typography.caption.fontSize, fontWeight: "800" },
  duration: { position: "absolute", right: 9, bottom: 9, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6, backgroundColor: "rgba(0,0,0,0.8)" },
  durationText: { color: colors.white, fontSize: typography.caption.fontSize, fontWeight: "800" },
});
