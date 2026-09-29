import { TvPageBackButton } from "./TvPageBackButton";
import type { ReactNode } from "react";
import { StyleSheet, Text, TVFocusGuideView, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { Translate } from "../i18n";
import { colors, screenPadding } from "../theme";
import { Logo } from "./Logo";
import { TvSurface } from "./TvSurface";
import { useViewport } from "../viewport";

export function TvSetupLayout({ title, description, t, onBack, children, copyFooter, copyHeader }: { title: string; description: string; t: Translate; onBack?: () => void; children: ReactNode; copyFooter?: ReactNode; copyHeader?: ReactNode }) {
  const { width, height } = useViewport();
  return <TVFocusGuideView autoFocus style={styles.screen}>
    <Svg pointerEvents="none" width={width} height={height} style={StyleSheet.absoluteFill}><Defs><LinearGradient id="setup-background" x1="1" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#172134" /><Stop offset="0.5" stopColor="#0b101a" /><Stop offset="1" stopColor={colors.background} /></LinearGradient></Defs><Rect width="100%" height="100%" fill="url(#setup-background)" /></Svg>
    {onBack ? <TvPageBackButton t={t} onPress={onBack} /> : null}
    <View style={[styles.header, onBack && styles.headerWithBack]}><Logo compact /></View>
    <View style={styles.body}>
      <View style={styles.copy}>{copyHeader}<Text accessibilityRole="header" style={styles.title}>{title}</Text><Text style={styles.description}>{description}</Text>{copyFooter}</View>
      <View style={styles.card}><TvSurface material="content" radius={38}>{children}</TvSurface></View>
    </View>
  </TVFocusGuideView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: screenPadding + 20, paddingVertical: 48 },
  header: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 28 },
  headerWithBack: { paddingLeft: 96 },
  body: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 100, paddingBottom: 35 },
  copy: { flex: 1, maxWidth: 650 }, title: { color: colors.text, fontSize: 58, lineHeight: 66, letterSpacing: -1.5, fontWeight: "700" },
  description: { color: colors.textMuted, fontSize: 23, lineHeight: 34, marginTop: 22, maxWidth: 570 },
  card: { flex: 1.15, maxWidth: 820, borderRadius: 38, padding: 36 },
});
