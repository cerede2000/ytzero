import { TvCloseButton } from "./TvCloseButton";
import { forwardRef, useCallback, useRef, useState } from "react";
import { Modal, StyleSheet, Text, TVFocusGuideView, TVTextScrollView, View, type FocusDestination } from "react-native";
import type { Translate } from "../i18n";
import { useReducedMotion } from "../motion";
import { colors, typography } from "../theme";
import { TvButton } from "./TvButton";
import { TvPressable } from "./TvPressable";
import { useTvModalBack } from "../useTvModalBack";
import { TvScreenTransition } from "./TvScreenTransition";
import { requestTvFocus } from "../focus";
import { TvFocusScope } from "./TvFocusScope";
import { TvModalCanvas } from "./TvModalCanvas";

export const TvTextDetails = forwardRef<View, { text: string; title: string; t: Translate; nextFocusUp?: FocusDestination; nextFocusDown?: FocusDestination }>(function TvTextDetails({ text, title, t, nextFocusUp, nextFocusDown }, ref) {
  const [open, setOpen] = useState(false);
  const [textFocused, setTextFocused] = useState(false);
  const reduced = useReducedMotion();
  const closeTarget = useRef<View>(null);
  const previewTarget = useRef<View | null>(null);
  const setPreviewTarget = useCallback((target: View | null) => {
    previewTarget.current = target;
    if (typeof ref === "function") ref(target);
    else if (ref) ref.current = target;
  }, [ref]);
  const close = () => { setOpen(false); requestAnimationFrame(() => previewTarget.current?.requestTVFocus()); };
  useTvModalBack(open, close, true);
  return <>
    <TvPressable ref={setPreviewTarget} deferPress focusScale={1.01} accessibilityRole="button" accessibilityLabel={title} nextFocusUp={nextFocusUp} nextFocusDown={nextFocusDown}
      onPress={() => setOpen(true)} style={({ focused }) => [styles.preview, focused && styles.focused]}>
      <Text numberOfLines={2} style={styles.text}>{text}</Text><Text style={styles.more}>{t("more")} ›</Text>
    </TvPressable>
    {open ? <Modal transparent animationType="none" onRequestClose={close} onShow={() => requestAnimationFrame(() => requestTvFocus(closeTarget.current))}>
      <TvModalCanvas>
      <TvFocusScope style={{ flex: 1 }}><TVFocusGuideView accessibilityViewIsModal autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.overlay}>
        <TvScreenTransition surface="content" radius={36} style={styles.panel}>
          <View style={styles.header}><Text accessibilityRole="header" numberOfLines={2} style={styles.title}>{title}</Text><TvCloseButton ref={closeTarget} t={t} preferredFocus onPress={close} /></View>
          <TVTextScrollView style={[styles.scroller, textFocused && styles.scrollerFocused]} onFocus={() => setTextFocused(true)} onBlur={() => setTextFocused(false)} contentContainerStyle={styles.content} scrollDuration={reduced ? 0 : 0.22} snapToStart={false} snapToEnd={false}><Text selectable={false} style={styles.fullText}>{text}</Text></TVTextScrollView>
        </TvScreenTransition>
      </TVFocusGuideView></TvFocusScope>
      </TvModalCanvas>
    </Modal> : null}
  </>;
});
const styles = StyleSheet.create({
  preview: { alignSelf: "stretch", borderWidth: 2, borderColor: "transparent", borderRadius: 18, padding: 12, marginLeft: -14, marginTop: 16 },
  focused: { borderColor: colors.white, backgroundColor: "rgba(255,255,255,0.1)" },
  text: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: 32 }, more: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, marginTop: 6 },
  overlay: { flex: 1, backgroundColor: colors.modalScrim, padding: 80, alignItems: "center", justifyContent: "center" },
  panel: { flex: 0, width: "100%", maxWidth: 1360, height: "100%", maxHeight: 850, borderRadius: 36, padding: 36 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 24 },
  title: { color: colors.text, fontSize: 32, fontWeight: "600", flex: 1, marginRight: 24 },
  scroller: { flex: 1, borderWidth: 2, borderColor: "transparent", borderRadius: 18 },
  scrollerFocused: { borderColor: colors.white }, content: { padding: 20 },
  fullText: { color: colors.text, fontSize: 24, lineHeight: 38 },
});
