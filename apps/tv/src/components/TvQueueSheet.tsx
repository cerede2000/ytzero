import { TvEmptyState } from "./TvEmptyState";
import { TvCloseButton } from "./TvCloseButton";
import { useEffect, useRef } from "react";
import { FlatList, Modal, StyleSheet, Text, TVFocusGuideView, View } from "react-native";
import { requestTvFocus } from "../focus";
import { useTvModalBack } from "../useTvModalBack";
import type { Translate } from "../i18n";
import type { Language } from "../types";
import { formatQueueCount } from "../queueCount";
import { sessionContext, type OpenVideo } from "../playbackQueue";
import { useSessionQueue } from "../SessionQueue";
import { colors, typography } from "../theme";
import { TvButton } from "./TvButton";
import { TvListButton } from "./TvListButton";
import { TvScreenTransition } from "./TvScreenTransition";
import { TvFocusScope } from "./TvFocusScope";
import { useViewport } from "../viewport";
import { TvModalCanvas } from "./TvModalCanvas";

export function TvQueueSheet({ t, language, onClose, onOpen, preserveMenuKey }: { t: Translate; language: Language; onClose: () => void; onOpen: OpenVideo; preserveMenuKey: boolean }) {
  useTvModalBack(true, onClose, preserveMenuKey);
  const queue = useSessionQueue();
  const { height } = useViewport();
  const targets = useRef(new Map<string, View>());
  const closeTarget = useRef<View>(null);
  const pendingFocus = useRef<{ videoId?: string } | null>(null);
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    let secondFrame: number | undefined;
    // Wait for the reordered native cells and their refs to finish mounting.
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => requestTvFocus(pending.videoId ? targets.current.get(pending.videoId) : closeTarget.current));
    });
    return () => { cancelAnimationFrame(firstFrame); if (secondFrame !== undefined) cancelAnimationFrame(secondFrame); };
  }, [queue.items]);
  const move = (id: string, delta: -1 | 1) => {
    pendingFocus.current = { videoId: id };
    queue.move(id, delta);
  };
  const focusAfterRemoval = (index: number) => {
    const target = queue.items[index + 1] ?? queue.items[index - 1];
    pendingFocus.current = { videoId: target?.video_id };
  };
  return <Modal transparent animationType="none" onRequestClose={onClose} visible
    onShow={() => requestAnimationFrame(() => requestTvFocus(targets.current.get(queue.items[0]?.video_id ?? "") ?? closeTarget.current))}>
    <TvModalCanvas>
    <TvFocusScope style={{ flex: 1 }}><TVFocusGuideView accessibilityViewIsModal autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={styles.overlay}>
      <TvScreenTransition surface="glass" radius={38} style={[styles.panel, { maxHeight: height - 100 }]}>
        <View style={styles.header}>
          <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>{t("playQueue")}</Text><Text style={styles.count}>{formatQueueCount(queue.items.length, language)}</Text></View>
          <TvCloseButton ref={closeTarget} t={t} preferredFocus={!queue.items.length} onPress={onClose} />
        </View>
        <FlatList data={queue.items} style={{ flexGrow: 0 }} contentContainerStyle={styles.list}
          keyExtractor={(item) => item.video_id} showsVerticalScrollIndicator={false}
          initialNumToRender={6} removeClippedSubviews={false}
          ListEmptyComponent={<TvEmptyState compact icon="playlists" title={t("queueEmpty")} description={t("queueEmptyHint")} />}
          renderItem={({ item, index }) => <View style={styles.row}>
            <View style={styles.video}>
              <TvListButton ref={(target) => { if (target) targets.current.set(item.video_id, target); else targets.current.delete(item.video_id); }}
                deferPress
                label={`${index + 1}. ${item.title}`} labelLines={2} detail={item.channel_title} hasTVPreferredFocus={index === 0}
                onPress={() => { onClose(); onOpen(item, sessionContext(queue.items), true); }} />
            </View>
            <TvButton label="" icon="up" accessibilityLabel={t("moveEarlier")} disabled={index === 0} onPress={() => move(item.video_id, -1)} />
            <TvButton label="" icon="down" accessibilityLabel={t("moveLater")} disabled={index === queue.items.length - 1} onPress={() => move(item.video_id, 1)} />
            <TvButton deferPress label="" icon="remove" accessibilityLabel={t("removeFromQueue")} onPress={() => { focusAfterRemoval(index); queue.remove(item.video_id); }} />
          </View>}
        />
        {queue.items.length ? <View style={styles.footer}><TvButton deferPress label={t("clearQueue")} variant="ghost" onPress={() => { pendingFocus.current = {}; queue.clear(); }} /></View> : null}
      </TvScreenTransition>
    </TVFocusGuideView></TvFocusScope>
    </TvModalCanvas>
  </Modal>;
}
const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.modalScrim, padding: 50, alignItems: "center", justifyContent: "center" },
  panel: { flex: 0, width: "100%", maxWidth: 1400, padding: 34, borderRadius: 38 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, marginBottom: 14 },
  title: { color: colors.text, fontSize: 36, fontWeight: "700" }, count: { color: colors.textMuted, fontSize: 24 },
  heading: { flex: 1, flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: 28, rowGap: 8 },
  list: { padding: 12, gap: 14 }, row: { flexDirection: "row", alignItems: "center", gap: 12 }, video: { flex: 1 },
  hint: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: 30, textAlign: "center", maxWidth: 720 }, footer: { alignItems: "flex-start", marginTop: 10 },
});
