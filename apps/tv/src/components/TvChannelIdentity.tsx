import { useState } from "react";
import { Image, StyleSheet, Text, View, type ImageURISource, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { colors, typography } from "../theme";
import { imageSourceWithHeaders } from "../imageSource";

/** Compact, non-focusable channel attribution shared by video surfaces. */
export function TvChannelIdentity({ title, source, size = 26, textStyle, style, detail }: {
  title: string; source?: ImageURISource; size?: number; textStyle?: StyleProp<TextStyle>; style?: StyleProp<ViewStyle>; detail?: string;
}) {
  const [failedUri, setFailedUri] = useState<string>();
  return <View style={[styles.row, style]}>
    <View accessible={false} style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      {source?.uri && failedUri !== source.uri
        ? <Image source={imageSourceWithHeaders(source)} resizeMode="cover" style={StyleSheet.absoluteFill} onError={() => setFailedUri(source.uri)} />
        : <Text style={[styles.initial, { fontSize: size * 0.55 }]}>{Array.from(title.trim())[0]?.toLocaleUpperCase()}</Text>}
    </View>
    <Text numberOfLines={1} style={[styles.name, textStyle]}>{title}</Text>
    {detail ? <Text style={[styles.detail, textStyle]}>· {detail}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  avatar: { flexShrink: 0, overflow: "hidden", backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  initial: { color: colors.textMuted, fontWeight: "600" },
  name: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, flexShrink: 1 },
  detail: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontVariant: ["tabular-nums"] },
});
