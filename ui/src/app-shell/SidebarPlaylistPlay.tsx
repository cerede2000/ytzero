import { useState } from "react";
import { Headphones, Play } from "lucide-react";
import { api, type UserPlaylist } from "../api";
import { setProfileAudioMode } from "../audioModePreference";
import { useI18n } from "../i18n";
import { playlistStartTarget } from "../playlistPlayback";
import type { UserPlaylistSort } from "../playlistSort";
import { usePlayVideo } from "../usePlayVideo";

/**
 * The order the playlist's own page opens in.
 *
 * Pressing play in the sidebar has to start the list somebody would see if they
 * opened it, so the two read it the same way round: `normalizeUserPlaylistSort`
 * settles on this when the page is opened without a sort of its own.
 */
const SIDEBAR_SORT: UserPlaylistSort = "added-newest";

/**
 * Play a whole list without opening it first.
 *
 * The sidebar knows each playlist's name and how many videos are in it, and
 * nothing about the videos themselves — so the press is what fetches them. That
 * is one request, made because somebody asked for it, rather than a request per
 * playlist made every time the sidebar renders on the chance one gets pressed.
 *
 * Two buttons rather than a button and a menu: a menu needs a press to open and
 * a press to choose, which is more work than opening the playlist would have
 * been, and the whole point of the pair is that neither mode costs a detour.
 */
export default function SidebarPlaylistPlay({ playlist }: { playlist: UserPlaylist }) {
  const { t } = useI18n();
  const play = usePlayVideo();
  const [starting, setStarting] = useState(false);

  const start = async (audio: boolean) => {
    if (starting) return;
    setStarting(true);
    try {
      const { playlist: full, videos } = await api.userPlaylist(playlist.id, SIDEBAR_SORT);
      const target = playlistStartTarget(videos);
      if (!target) return;
      // Written for the videos that follow, and stated to the navigation for
      // this one: the preference is keyed on the profile this browser remembers
      // being, and a browser that was never told has nowhere to keep it.
      setProfileAudioMode(audio);
      play(
        target,
        { version: 1, kind: "user-playlist", playlistUuid: full.portable_uuid, sort: SIDEBAR_SORT },
        { fromStart: true, audio },
      );
    } catch (error) {
      console.error("Unable to start a playlist from the sidebar", error);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="sidebar-playlist-play">
      <button
        type="button"
        className="sidebar-playlist-play-btn"
        title={t("playlistPlayAll")}
        aria-label={`${playlist.name} — ${t("playlistPlayAll")}`}
        disabled={starting}
        onClick={() => start(false)}
      >
        <Play size={12} />
      </button>
      <button
        type="button"
        className="sidebar-playlist-play-btn"
        title={t("playlistPlayAllAudioOnly")}
        aria-label={`${playlist.name} — ${t("playlistPlayAllAudioOnly")}`}
        disabled={starting}
        onClick={() => start(true)}
      >
        <Headphones size={12} />
      </button>
    </div>
  );
}
