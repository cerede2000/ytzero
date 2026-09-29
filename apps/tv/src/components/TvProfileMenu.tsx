import { TvPageBackButton } from "./TvPageBackButton";
import { TvProfileBackdrop } from "./TvProfileBackdrop";
import { TvCloseButton } from "./TvCloseButton";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  Image,
  Modal,
  StyleSheet,
  Text,
  TVFocusGuideView,
  View,
  type FocusDestination,
  type ListRenderItemInfo,
} from "react-native";
import type { YtZeroApi } from "../api";
import type { Translate } from "../i18n";
import type { Profile } from "../types";
import { colors, typography } from "../theme";
import { TvButton } from "./TvButton";
import { TvHorizontalList } from "./TvHorizontalList";
import { TvSwitch } from "./TvSwitch";
import { TvPressable } from "./TvPressable";
import { TvControlSurface, TvSurfaceRoot } from "./TvSurface";
import { TvTextField } from "./TvTextField";
import { TvScreenTransition } from "./TvScreenTransition";
import { TvFocusScope } from "./TvFocusScope";
import { useTvModalBack } from "../useTvModalBack";
import Svg, { Path } from "react-native-svg";
import { imageSourceWithHeaders } from "../imageSource";

type Props = {
  selection?: { preferredProfileId?: number; title: string; description: string; onCancel: () => void };
  active: Profile;
  api: YtZeroApi;
  canSwitch: boolean;
  childLockEnabled: boolean;
  contentFocusTarget?: FocusDestination;
  incognito: boolean;
  onIncognitoChange: (value: boolean) => void;
  onTriggerReady: (target: View | null) => void;
  onVisibilityChange: (visible: boolean) => void;
  onSwitch: (profileId: number, pin?: string, childLockPin?: string) => Promise<void>;
  preserveMenuKey: boolean;
  profiles: Profile[];
  t: Translate;
};

type MenuView = "menu" | "profiles";

const profileKey = (profile: Profile) => String(profile.id);
const profileAccentSettleMs = 90;

type ProfileBackdropHandle = {
  restoreAccent: (leavingAccent: string, restingAccent: string) => void;
  showAccent: (accent: string) => void;
};

/** Keep gradient work outside the picker tree and off the critical focus frame. */
const DeferredProfileBackdrop = memo(forwardRef<ProfileBackdropHandle, { initialAccent: string }>(function DeferredProfileBackdrop({ initialAccent }, ref) {
  const [accent, setAccent] = useState(initialAccent);
  const renderedAccent = useRef(initialAccent);
  const requestedAccent = useRef(initialAccent);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPending = useCallback(() => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const showAccent = useCallback((next: string) => {
    requestedAccent.current = next;
    cancelPending();
    if (renderedAccent.current === next) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const settled = requestedAccent.current;
      if (renderedAccent.current === settled) return;
      renderedAccent.current = settled;
      setAccent(settled);
    }, profileAccentSettleMs);
  }, [cancelPending]);
  const restoreAccent = useCallback((leavingAccent: string, restingAccent: string) => {
    // UIKit normally blurs the old card before focusing the next one. If those
    // events arrive in the opposite order, never overwrite the newer preview.
    if (requestedAccent.current === leavingAccent) showAccent(restingAccent);
  }, [showAccent]);
  useImperativeHandle(ref, () => ({ restoreAccent, showAccent }), [restoreAccent, showAccent]);
  useEffect(() => {
    cancelPending();
    requestedAccent.current = initialAccent;
    renderedAccent.current = initialAccent;
    setAccent(initialAccent);
  }, [cancelPending, initialAccent]);
  useEffect(() => cancelPending, [cancelPending]);
  return <TvProfileBackdrop accent={accent} />;
}));

type ProfilePickerCardProps = {
  api: YtZeroApi;
  busy: boolean;
  nextFocusDown?: FocusDestination;
  onChoose: (profile: Profile) => void;
  onLeaveAccent: (accent: string) => void;
  onPreviewAccent: (accent: string) => void;
  preferredProfileId: number;
  profile: Profile;
  t: Translate;
};

/** Each card owns its visual focus state through TvPressable. Moving focus no
 * longer invalidates the FlatList or the other profile cards. */
const ProfilePickerCard = memo(function ProfilePickerCard({ api, busy, nextFocusDown, onChoose, onLeaveAccent, onPreviewAccent, preferredProfileId, profile, t }: ProfilePickerCardProps) {
  const active = profile.active;
  return (
    <TvPressable
      accessibilityRole="button"
      deferPress
      accessibilityState={{ selected: active, disabled: Boolean(profile.pin_locked), busy }}
      accessibilityLabel={profile.pin_locked ? `${profile.name}. ${t("profileLocked")}` : profile.name}
      disabled={profile.pin_locked}
      nextFocusDown={nextFocusDown}
      focusScale={1.065}
      hasTVPreferredFocus={profile.id === preferredProfileId}
      onBlur={() => onLeaveAccent(profile.avatar_color)}
      onFocus={() => onPreviewAccent(profile.avatar_color)}
      onPress={() => onChoose(profile)}
      style={({ focused, pressed }) => [
        styles.profileCard,
        focused && styles.profileCardFocused,
        profile.pin_locked && styles.profileCardDisabled,
        pressed && styles.pressed,
      ]}
    >
      {({ focused }) => <>
        <View style={[styles.profilePortrait, focused && styles.profilePortraitFocused]}>
          <ProfileAvatar api={api} profile={profile} size={168} />
          {active ? <View accessible={false} style={styles.currentBadge}>
            <Svg width={26} height={26} viewBox="0 0 24 24"><Path fill={colors.white} d="m9 16.2-4.2-4.2L3.4 13.4 9 19l12-12-1.4-1.4z" /></Svg>
          </View> : null}
        </View>
        <Text numberOfLines={2} style={[styles.profileName, focused && styles.profileNameFocused]}>{profile.name}</Text>
        {(active || profile.pin_locked) && (
          <Text numberOfLines={1} style={[styles.profileMeta, focused && styles.profileMetaFocused]}>
            {active ? t("currentProfile") : t("profileLocked")}
          </Text>
        )}
        {profile.has_pin && <Text style={[styles.pinBadge, focused && styles.pinBadgeFocused]}>PIN</Text>}
      </>}
    </TvPressable>
  );
});

export function TvProfileMenu({
  selection,
  active,
  api,
  canSwitch,
  childLockEnabled,
  contentFocusTarget,
  incognito,
  onIncognitoChange,
  onTriggerReady,
  onVisibilityChange,
  onSwitch,
  preserveMenuKey,
  profiles,
  t,
}: Props) {
  const [open, setOpen] = useState(Boolean(selection));
  const [view, setView] = useState<MenuView>(selection ? "profiles" : "menu");
  const [pickerBackTarget, setPickerBackTarget] = useState<View | null>(null);
  const [pinFor, setPinFor] = useState<Profile | null>(null);
  const [profilePin, setProfilePin] = useState("");
  const [childLockPin, setChildLockPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const triggerRef = useRef<View>(null);
  const pickerBackdrop = useRef<ProfileBackdropHandle>(null);
  const hadOverlay = useRef(false);
  const switchableProfiles = useMemo(
    () => profiles.filter((profile) => profile.id === active.id || (canSwitch && profile.can_switch)),
    [active.id, canSwitch, profiles],
  );
  const preferredProfileId = selection?.preferredProfileId ?? active.id;
  const activeProfileIndex = useMemo(
    () => switchableProfiles.findIndex((profile) => profile.id === preferredProfileId),
    [preferredProfileId, switchableProfiles],
  );
  const persistentProfileIndices = useMemo(
    () => activeProfileIndex >= 0 ? [activeProfileIndex] : [],
    [activeProfileIndex],
  );
  const canChooseProfile = canSwitch && switchableProfiles.length > 1;
  const overlayVisible = open || pinFor !== null;
  useEffect(() => { onVisibilityChange(overlayVisible); return () => onVisibilityChange(false); }, [onVisibilityChange, overlayVisible]);
  const needsChildLock = Boolean(pinFor && pinFor.id !== active.id && active.is_child && childLockEnabled);
  const pinComplete = Boolean(
    pinFor
    && (!pinFor.has_pin || /^\d{6}$/.test(profilePin))
    && (!needsChildLock || /^\d{6}$/.test(childLockPin)),
  );

  const setTriggerRef = useCallback((target: View | null) => {
    triggerRef.current = target;
    onTriggerReady(target);
  }, [onTriggerReady]);

  const clearPin = useCallback(() => {
    setPinFor(null);
    setProfilePin("");
    setChildLockPin("");
    setError(false);
  }, []);

  const close = useCallback(() => {
    if (busy) return;
    if (selection) return selection.onCancel();
    setOpen(false);
    setView("menu");
    clearPin();
  }, [busy, clearPin, selection]);

  const returnToProfiles = useCallback(() => {
    if (busy) return;
    clearPin();
    setView("profiles");
    setOpen(true);
  }, [busy, clearPin]);

  useEffect(() => {
    if (overlayVisible) {
      hadOverlay.current = true;
      return;
    }
    if (!hadOverlay.current) return;
    hadOverlay.current = false;
    const frame = requestAnimationFrame(() => triggerRef.current?.requestTVFocus());
    return () => cancelAnimationFrame(frame);
  }, [overlayVisible]);

  useTvModalBack(overlayVisible, () => {
      if (pinFor) returnToProfiles();
      else if (selection) close();
      else if (view === "profiles") setView("menu");
      else close();
  }, preserveMenuKey);

  const openMenu = () => {
    setError(false);
    setView("menu");
    setOpen(true);
  };

  const performSwitch = useCallback(async (requestedProfile?: Profile) => {
    const profile = requestedProfile ?? pinFor;
    if (!profile || busy) return;
    setBusy(true);
    setError(false);
    try {
      await onSwitch(profile.id, profilePin || undefined, childLockPin || undefined);
      setOpen(false);
      setView("menu");
      setPinFor(null);
      setProfilePin("");
      setChildLockPin("");
    } catch {
      setError(true);
      setProfilePin("");
      setChildLockPin("");
    } finally {
      setBusy(false);
    }
  }, [busy, childLockPin, onSwitch, pinFor, profilePin]);

  const choose = useCallback((profile: Profile) => {
    if (profile.active && !selection) return setView("menu");
    if (profile.pin_locked || busy) return;
    const childPinRequired = profile.id !== active.id && active.is_child && childLockEnabled;
    if (profile.has_pin || childPinRequired) {
      setOpen(false);
      setPinFor(profile);
      setProfilePin("");
      setChildLockPin("");
      setError(false);
      return;
    }
    void performSwitch(profile);
  }, [active.id, active.is_child, busy, childLockEnabled, performSwitch, selection]);

  const previewProfileAccent = useCallback((accent: string) => {
    pickerBackdrop.current?.showAccent(accent);
  }, []);
  const leaveProfileAccent = useCallback((accent: string) => {
    pickerBackdrop.current?.restoreAccent(accent, active.avatar_color);
  }, [active.avatar_color]);
  const renderProfile = useCallback(({ item: profile }: ListRenderItemInfo<Profile>) => (
    <ProfilePickerCard
      api={api}
      busy={busy}
      nextFocusDown={pickerBackTarget ?? undefined}
      onChoose={choose}
      onLeaveAccent={leaveProfileAccent}
      onPreviewAccent={previewProfileAccent}
      preferredProfileId={preferredProfileId}
      profile={profile}
      t={t}
    />
  ), [api, busy, choose, leaveProfileAccent, pickerBackTarget, preferredProfileId, previewProfileAccent, t]);

  return (
    <>
      {!selection && <View style={styles.triggerWrap}>
        <TvPressable
          ref={setTriggerRef}
          deferPress
          accessibilityRole="button"
          accessibilityLabel={`${t("currentProfile")}: ${active.name}. ${t("profiles")}`}
          nextFocusDown={contentFocusTarget}
          onPress={openMenu}
          style={({ focused }) => [styles.trigger, focused && styles.triggerFocused]}
        >
          {({ focused }) => <>
            <TvControlSurface focused={focused} floating filled={false} radius={33} />
            <View>
              <ProfileAvatar api={api} profile={active} size={48} />
              {incognito && <View style={styles.incognitoDot} />}
            </View>
            <Text numberOfLines={1} style={[styles.triggerName, focused && styles.triggerNameFocused]}>{active.name}</Text>
          </>}
        </TvPressable>
      </View>}

      <Modal visible={overlayVisible} transparent animationType="none" onRequestClose={() => { if (pinFor) returnToProfiles(); else if (selection) close(); else if (view === "profiles") setView("menu"); else close(); }}>
      <TvSurfaceRoot><TvFocusScope style={{ flex: 1 }}>
      {open && (
        <TVFocusGuideView accessibilityViewIsModal autoFocus trapFocusDown trapFocusLeft trapFocusRight trapFocusUp style={[styles.overlay, view === "profiles" && styles.fullscreenOverlay]}>
          {view === "profiles" ? <DeferredProfileBackdrop ref={pickerBackdrop} initialAccent={active.avatar_color} /> : null}
          {view === "profiles" && !selection ? <TvPageBackButton ref={setPickerBackTarget} t={t} onPress={() => { setError(false); setView("menu"); }} /> : null}
          {view === "menu" ? (
            <TvScreenTransition surface="glass" radius={40} style={styles.menuPanel}>
              <View style={styles.hero}>
                <View>
                  <ProfileAvatar api={api} profile={active} size={112} />
                  {incognito && <View style={styles.heroIncognitoDot} />}
                </View>
                <Text numberOfLines={1} style={styles.heroName}>{active.name}</Text>
                <Text style={[styles.heroMeta, incognito && styles.heroMetaIncognito]}>
                  {incognito ? t("incognitoMode") : t("currentProfile")}
                </Text>
              </View>
              <View style={styles.menuActions}>
                <TvButton
                  disabled={!canChooseProfile}
                  deferPress
                  focusScale={1.025}
                  label={t("switchProfile")}
                  preferredFocus={canChooseProfile}
                  style={styles.menuAction}
                  onPress={() => { setError(false); setView("profiles"); }}
                />
                {!active.is_child && (
                  <TvSwitch
                    description={t("incognitoModeHint")}
                    label={t("incognitoMode")}
                    onValueChange={onIncognitoChange}
                    preferredFocus={!canChooseProfile}
                    value={incognito}
                  />
                )}
              </View>
              <TvCloseButton
                t={t}
                style={styles.menuClose}
                preferredFocus={active.is_child && !canChooseProfile}
                variant="ghost"
                onPress={close}
              />
            </TvScreenTransition>
          ) : (
            <TvScreenTransition style={styles.pickerPanel}>
              <Text accessibilityRole="header" style={styles.pickerTitle}>{selection?.title ?? t("switchProfile")}</Text>
              {selection ? <Text style={styles.selectionDescription}>{selection.description}</Text> : null}
              <TvHorizontalList
                data={switchableProfiles}
                estimatedItemExtent={312}
                edgeEffect={false}
                initialScrollIndex={activeProfileIndex > 0 ? activeProfileIndex : undefined}
                itemExtent={312}
                keyExtractor={profileKey}
                persistentRenderIndices={persistentProfileIndices}
                renderItem={renderProfile}
                style={styles.profileList}
                contentContainerStyle={styles.profileListContent}
                wrapperStyle={styles.profileListWrap}
              />
              {error && <Text style={styles.error}>{t("actionFailed")}</Text>}
              {selection
                ? <TvButton ref={setPickerBackTarget} deferPress label={t("changeInstance")} variant="ghost" disabled={busy} onPress={selection.onCancel} />
                : null}
            </TvScreenTransition>
          )}
        </TVFocusGuideView>
      )}

      {pinFor && (
        <TVFocusGuideView accessibilityViewIsModal autoFocus trapFocusDown trapFocusLeft trapFocusRight trapFocusUp style={[styles.overlay, styles.fullscreenOverlay]}>
          <TvProfileBackdrop accent={pinFor.avatar_color} />
          <TvPageBackButton t={t} onPress={returnToProfiles} disabled={busy} />
          <TvScreenTransition surface="content" radius={34} style={styles.pinCard}>
            <View style={styles.pinHeading}>
              <ProfileAvatar api={api} profile={pinFor} size={76} />
              <View style={styles.pinCopy}>
                <Text style={styles.pinEyebrow}>{t("switchProfile")}</Text>
                <Text numberOfLines={1} style={styles.pinTitle}>{pinFor.name}</Text>
              </View>
            </View>
            {needsChildLock && (
              <PinField
                label={t("enterChildLockPin")}
                preferredFocus
                onSubmit={() => { if (pinComplete) void performSwitch(); }}
                onValue={(value) => { setChildLockPin(value); setError(false); }}
                value={childLockPin}
              />
            )}
            {pinFor.has_pin && (
              <PinField
                label={t("enterProfilePin")}
                preferredFocus={!needsChildLock}
                onSubmit={() => { if (pinComplete) void performSwitch(); }}
                onValue={(value) => { setProfilePin(value); setError(false); }}
                value={profilePin}
              />
            )}
            {error && <Text style={styles.error}>{t("invalidPin")}</Text>}
            <View style={styles.pinActions}>
              <TvButton deferPress label={busy ? t("switchingProfile") : t("switchProfile")} variant="primary" disabled={!pinComplete || busy} onPress={() => void performSwitch()} />
            </View>
          </TvScreenTransition>
        </TVFocusGuideView>
      )}
      </TvFocusScope></TvSurfaceRoot></Modal>
    </>
  );
}

function ProfileAvatar({ api, profile, size }: { api: YtZeroApi; profile: Profile; size: number }) {
  const initial = (profile.name.trim()[0] ?? "?").toLocaleUpperCase();
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: profile.avatar ? colors.surfaceRaised : profile.avatar_color }]}>
      {profile.avatar ? (
        <Image source={imageSourceWithHeaders(api.avatarSource(profile.avatar))} style={{ width: size, height: size, borderRadius: size / 2 }} resizeMode="cover" />
      ) : (
        <Text style={[styles.avatarInitial, { fontSize: Math.round(size * 0.42) }]}>{initial}</Text>
      )}
    </View>
  );
}

function PinField({ label, onSubmit, onValue, preferredFocus, value }: {
  label: string;
  onSubmit: () => void;
  onValue: (value: string) => void;
  preferredFocus: boolean;
  value: string;
}) {
  return (
    <View style={styles.pinField}>
      <Text style={styles.pinLabel}>{label}</Text>
      <TvTextField
        accessibilityLabel={label}
        autoCorrect={false}
        hasTVPreferredFocus={preferredFocus}
        keyboardType="number-pad"
        maxLength={6}
        onChangeText={(next) => onValue(next.replace(/\D/g, "").slice(0, 6))}
        onSubmitEditing={onSubmit}
        placeholder="••••••"
        placeholderTextColor={colors.textMuted}
        secureTextEntry
        style={styles.pinInput}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  selectionDescription: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: 32, maxWidth: 1000, marginBottom: 24 },
  triggerWrap: { overflow: "visible" },
  trigger: { minWidth: 150, maxWidth: 330, minHeight: 66, paddingHorizontal: 9, paddingRight: 18, borderRadius: 33, flexDirection: "row", alignItems: "center", gap: 12 },
  triggerFocused: { shadowColor: colors.black, shadowOpacity: 0.5, shadowRadius: 22, shadowOffset: { width: 0, height: 11 } },
  triggerName: { flexShrink: 1, color: colors.text, fontSize: typography.caption.fontSize, fontWeight: "700" },
  triggerNameFocused: { color: colors.text },
  pressed: {},
  avatar: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarInitial: { color: colors.white, fontWeight: "800" },
  incognitoDot: { position: "absolute", right: -1, bottom: -1, width: 15, height: 15, borderRadius: 8, backgroundColor: colors.success },
  heroIncognitoDot: { position: "absolute", right: 3, bottom: 3, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.success },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 100, backgroundColor: colors.modalScrim, alignItems: "center", justifyContent: "center", paddingHorizontal: 72, paddingVertical: 46 },
  menuPanel: { flex: 0, width: 790, alignItems: "center", padding: 36 },
  fullscreenOverlay: { backgroundColor: colors.background, paddingHorizontal: 72, paddingVertical: 120 },
  menuClose: { position: "absolute", top: 22, right: 22 },
  hero: { alignItems: "center", marginBottom: 34 },
  heroName: { maxWidth: 680, color: colors.text, fontSize: 42, lineHeight: 50, fontWeight: "800", letterSpacing: -1.1, marginTop: 18 },
  heroMeta: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "600", marginTop: 5 },
  heroMetaIncognito: { color: colors.success },
  menuActions: { width: "100%", gap: 18, padding: 18, marginBottom: 4 },
  menuAction: { width: "100%", minHeight: 80, borderRadius: 28 },
  pickerPanel: { flex: 0, width: "100%", maxWidth: 1400, alignItems: "center", paddingVertical: 36 },
  pickerTitle: { color: colors.text, fontSize: 57, lineHeight: 66, fontWeight: "700", letterSpacing: -1.4, marginBottom: 40 },
  profileListWrap: { overflow: "visible" },
  profileList: { width: "100%", flexGrow: 0, overflow: "visible" },
  profileListContent: { minWidth: "100%", flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 100, paddingVertical: 30 },
  profileCard: { width: 284, minHeight: 334, marginHorizontal: 14, borderRadius: 30, paddingHorizontal: 22, paddingVertical: 24, alignItems: "center", justifyContent: "flex-start", backgroundColor: "transparent" },
  profileCardFocused: { shadowColor: colors.black, shadowOpacity: 0.5, shadowRadius: 26, shadowOffset: { width: 0, height: 14 } },
  profilePortrait: { padding: 9, borderRadius: 99, borderWidth: 3, borderColor: "transparent" },
  profilePortraitFocused: { borderColor: colors.text, shadowColor: colors.accentStrong, shadowOpacity: 0.55, shadowRadius: 30, shadowOffset: { width: 0, height: 0 } },
  currentBadge: { position: "absolute", right: 5, bottom: 5, width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: colors.background },
  profileCardDisabled: { opacity: 0.42 },
  profileName: { color: colors.textMuted, fontSize: 31, lineHeight: 38, fontWeight: "600", textAlign: "center", marginTop: 20 },
  profileNameFocused: { color: colors.text },
  profileMeta: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, marginTop: 5 },
  profileMetaFocused: { color: colors.text },
  pinBadge: { color: colors.textMuted, fontSize: typography.caption.fontSize, fontWeight: "800", letterSpacing: 0.8, marginTop: 7 },
  pinBadgeFocused: { color: colors.text },
  pinCard: { flex: 0, width: 640, padding: 34, borderRadius: 34, gap: 20 },
  pinHeading: { flexDirection: "row", alignItems: "center", gap: 20, marginBottom: 4 },
  pinCopy: { flex: 1 },
  pinEyebrow: { color: colors.textMuted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight, fontWeight: "700" },
  pinTitle: { color: colors.text, fontSize: 32, lineHeight: 39, fontWeight: "800", marginTop: 3 },
  pinField: { gap: 9 },
  pinLabel: { color: colors.textMuted, fontSize: typography.caption.fontSize, fontWeight: "600" },
  pinInput: { minHeight: 80, color: colors.text, fontSize: 28, fontWeight: "800", letterSpacing: 10, textAlign: "center" },
  error: { color: colors.danger, fontSize: typography.caption.fontSize, fontWeight: "700", marginBottom: 8 },
  pinActions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 4 },
});
