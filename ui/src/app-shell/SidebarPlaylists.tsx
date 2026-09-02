import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Plus } from "lucide-react";
import { api, type UserPlaylist } from "../api";
import { subscribe } from "../events";
import { useI18n } from "../i18n";
import { PlaylistIcon } from "../components/PlaylistIcon";
import { Input } from "../components/ui";
import { filterPlaylistsByName } from "../playlistSearch";
import "./SidebarPlaylists.css";

export default function SidebarPlaylists() {
  const { t } = useI18n();
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const [shadowTop, setShadowTop] = useState(false);
  const [shadowBottom, setShadowBottom] = useState(false);
  const filteredPlaylists = useMemo(() => filterPlaylistsByName(playlists, query), [playlists, query]);

  const load = useCallback(() => {
    api.userPlaylists()
      .then((result) => setPlaylists(result.playlists))
      .catch((error) => console.error("Unable to load sidebar playlists", error))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => subscribe("playlists-changed", load), [load]);

  const updateShadows = useCallback(() => {
    const element = listRef.current;
    if (!element) return;
    setShadowTop(element.scrollTop > 4);
    setShadowBottom(element.scrollTop + element.clientHeight < element.scrollHeight - 4);
  }, []);

  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    updateShadows();
    element.addEventListener("scroll", updateShadows, { passive: true });
    const resizeObserver = new ResizeObserver(updateShadows);
    resizeObserver.observe(element);
    return () => {
      element.removeEventListener("scroll", updateShadows);
      resizeObserver.disconnect();
    };
  }, [filteredPlaylists, loading, updateShadows]);

  return (
    <div className="sidebar-playlists">
      <div className="sidebar-section-title">
        <span>{t("myPlaylists")}</span>
        <Link className="sidebar-add-btn" title={t("newPlaylist")} aria-label={t("newPlaylist")} to="/settings?tab=playlists">
          <Plus size={15} />
        </Link>
      </div>
      <Input
        className="sidebar-playlist-search"
        size="sm"
        type="search"
        value={query}
        placeholder={t("playlistSearchPlaceholder")}
        aria-label={t("playlistSearchPlaceholder")}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className={`sidebar-playlists-scroll-wrap${shadowTop ? " shadow-top" : ""}${shadowBottom ? " shadow-bot" : ""}`}>
        <div className="sidebar-playlists-scroll" ref={listRef}>
          {loading && playlists.length === 0 && (
            <div className="sidebar-skeleton-list" aria-label={t("loading")}>
              {Array.from({ length: 3 }, (_, index) => (
                <div className="sidebar-skeleton-item" aria-hidden="true" key={index}>
                  <div className="skeleton sidebar-skeleton-square" />
                  <div className="skeleton skeleton-line" />
                </div>
              ))}
            </div>
          )}
          {!loading && filteredPlaylists.length === 0 && (
            <div className="sidebar-playlists-empty">{query.trim() ? t("noMatchingPlaylists") : t("noPlaylists")}</div>
          )}
          {filteredPlaylists.map((playlist) => (
            <NavLink key={playlist.id} to={`/playlists/${playlist.id}`} className={({ isActive }) => `sidebar-playlist-item${isActive ? " active" : ""}`}>
              <span className="sidebar-playlist-icon"><PlaylistIcon icon={playlist.icon} /></span>
              <span className="sidebar-sub-name">{playlist.name}</span>
              <span className="sidebar-playlist-count">{playlist.video_count}</span>
            </NavLink>
          ))}
        </div>
      </div>
    </div>
  );
}
