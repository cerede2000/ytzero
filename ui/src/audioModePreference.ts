import { useCallback, useState } from "react";
import { rememberedProfileId } from "./profilePreference";

const AUDIO_MODE_KEY_PREFIX = "ytzero.audioMode.profile.";

function storage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function key(profileId: number | null): string | null {
  return Number.isSafeInteger(profileId) && Number(profileId) > 0
    ? `${AUDIO_MODE_KEY_PREFIX}${profileId}`
    : null;
}

export function profileAudioModeEnabled(profileId: number | null): boolean {
  const storageKey = key(profileId);
  if (!storageKey) return false;
  try { return storage()?.getItem(storageKey) === "1"; } catch { return false; }
}

export function rememberProfileAudioMode(profileId: number | null, enabled: boolean): void {
  const storageKey = key(profileId);
  if (!storageKey) return;
  try {
    if (enabled) storage()?.setItem(storageKey, "1");
    else storage()?.removeItem(storageKey);
  } catch {}
}

/**
 * Choose the mode for the profile that is signed in here.
 *
 * The watch page reads the remembered mode as it opens, so a page that starts
 * playback elsewhere states the mode before it navigates rather than arguing
 * with the player once it is up.
 */
export function setProfileAudioMode(enabled: boolean): void {
  rememberProfileAudioMode(rememberedProfileId(), enabled);
}

export function useProfileAudioMode(): [boolean, (enabled: boolean) => void] {
  const [profileId] = useState(rememberedProfileId);
  const [enabled, setEnabled] = useState(() => profileAudioModeEnabled(profileId));
  const update = useCallback((next: boolean) => {
    setEnabled(next);
    rememberProfileAudioMode(profileId, next);
  }, [profileId]);
  return [enabled, update];
}
