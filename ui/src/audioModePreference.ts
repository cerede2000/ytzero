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

/**
 * The mode a page opens in.
 *
 * A stated mode wins over the remembered one: it is the more recent thing the
 * reader said — they pressed "listen" a second ago — and it is the only thing
 * that carries the choice on a browser with no remembered profile, where the
 * preference has nowhere to be written and reads back false for ever.
 */
export function resolveAudioMode(requested: boolean | undefined, profileId: number | null): boolean {
  return requested ?? profileAudioModeEnabled(profileId);
}

export function useProfileAudioMode(requested?: boolean): [boolean, (enabled: boolean) => void] {
  const [profileId] = useState(rememberedProfileId);
  const [enabled, setEnabled] = useState(() => resolveAudioMode(requested, profileId));
  const update = useCallback((next: boolean) => {
    setEnabled(next);
    rememberProfileAudioMode(profileId, next);
  }, [profileId]);
  return [enabled, update];
}
