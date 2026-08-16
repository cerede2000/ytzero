import { Headphones, Play, SkipForward } from "lucide-react";
import type { Video } from "../api";
import { setProfileAudioMode } from "../audioModePreference";
import { useI18n } from "../i18n";
import { playlistContinueTarget } from "../playlistPlayback";
import { MenuItem, SplitButton } from "./ui";

export default function PlaylistPlaybackActions({ videos, disabled = false, onPlay }: {
  videos: readonly Video[];
  disabled?: boolean;
  onPlay: (video: Video) => void;
}) {
  const { t } = useI18n();
  const first = videos[0];
  const continuation = playlistContinueTarget(videos);
  if (!first) return null;

  // A list is started in one mode or the other, and the watch page reads that
  // choice as it opens. Pressing the button plays the video; the arrow is for
  // the times a list is meant to be listened to rather than watched, and the
  // choice sticks afterwards exactly as the player's own toggle does.
  const start = (video: Video, audio: boolean) => {
    setProfileAudioMode(audio);
    onPlay(video);
  };

  return <>
    {continuation && (
      <SplitButton
        variant="primary"
        disabled={disabled}
        leadingIcon={<SkipForward />}
        menuLabel={t("playlistPlayModes")}
        onClick={() => start(continuation, false)}
        menu={<MenuItem icon={<Headphones />} onClick={() => start(continuation, true)}>{t("continueWatchingAudio")}</MenuItem>}
      >
        {t("continueWatching")}
      </SplitButton>
    )}
    <SplitButton
      variant={continuation ? "default" : "primary"}
      disabled={disabled}
      leadingIcon={<Play />}
      menuLabel={t("playlistPlayModes")}
      onClick={() => start(first, false)}
      menu={<MenuItem icon={<Headphones />} onClick={() => start(first, true)}>{t("playlistPlayAllAudio")}</MenuItem>}
    >
      {t("playlistPlayAll")}
    </SplitButton>
  </>;
}
