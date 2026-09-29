import { useEffect, useRef, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, TVFocusGuideView, View } from "react-native";
import { focusWhenReady } from "../focus";
import type { Translate } from "../i18n";
import { useTvModalBack } from "../useTvModalBack";
import { colors, typography } from "../theme";
import { TvCloseButton } from "./TvCloseButton";
import { TvFocusScope } from "./TvFocusScope";
import { TvSurface } from "./TvSurface";
import { TvListButton } from "./TvListButton";
import { TvModalCanvas } from "./TvModalCanvas";

export function TvChoiceSheet<T extends string>({ title, options, value, busy, error, t, onSelect, onClose }: {
  title: string; options: ReadonlyArray<{ value: T; label: string }>; value: T;
  busy?: boolean; error?: string; t: Translate; onSelect: (value: T) => void; onClose: () => void;
}) {
  useTvModalBack(true, onClose, true);
  const targets = useRef(new Map<T, View>());
  const [shown, setShown] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!shown || focused) return;
    const target = targets.current.get(value) ?? (options[0] ? targets.current.get(options[0].value) : undefined);
    if (target) return focusWhenReady(target, () => setFocused(true));
  }, [focused, options, shown, value]);
  return <Modal transparent visible animationType="none" onShow={() => setShown(true)} onRequestClose={onClose}>
    <TvModalCanvas>
    <TvFocusScope style={styles.fill}><TVFocusGuideView accessibilityViewIsModal autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.overlay}>
      <View style={styles.panel}>
        <TvSurface radius={38}>
        <View style={styles.header}><Text accessibilityRole="header" style={styles.title}>{title}</Text><TvCloseButton focusable={focused} t={t} variant="ghost" onPress={onClose} /></View>
        <ScrollView style={styles.scroller} contentContainerStyle={styles.list}>
          {options.map((option) => <TvListButton key={option.value}
            ref={(target) => { if (target) targets.current.set(option.value, target); else targets.current.delete(option.value); }}
            surface="plain" indicator={value === option.value ? "check" : null} label={option.label}
            accessibilityState={{ selected: value === option.value, busy }} onPress={() => { if (!busy) onSelect(option.value); }} />)}
        </ScrollView>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        </TvSurface>
      </View>
    </TVFocusGuideView></TvFocusScope>
    </TvModalCanvas>
  </Modal>;
}
const styles = StyleSheet.create({
  fill: { flex: 1 }, overlay: { flex: 1, padding: 60, alignItems: "center", justifyContent: "center", backgroundColor: colors.modalScrim },
  panel: { width: 880, maxWidth: "100%", maxHeight: "100%", padding: 30, borderRadius: 38 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingLeft: 38, paddingRight: 12, marginBottom: 16 },
  title: { color: colors.text, fontSize: 32, fontWeight: "700", flex: 1 }, scroller: { flexGrow: 0, flexShrink: 1 }, list: { gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  error: { color: colors.textMuted, fontSize: typography.caption.fontSize, padding: 12 },
});
