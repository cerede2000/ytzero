import { profileAudioModeEnabled, rememberProfileAudioMode } from "./audioModePreference";
import { rememberedProfileId } from "./profilePreference";

export function otherPlaybackModeIsAudioOnly(): boolean {
  return !profileAudioModeEnabled(rememberedProfileId());
}

/** Persist the requested mode before navigation so the watch page starts in it. */
export function playVideoInOtherPlaybackMode<T>(video: T, onPlay: (video: T) => void): void {
  const profileId = rememberedProfileId();
  rememberProfileAudioMode(profileId, !profileAudioModeEnabled(profileId));
  onPlay(video);
}
