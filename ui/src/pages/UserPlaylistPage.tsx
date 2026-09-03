import { useCallback, useEffect, useState } from "react";
import "./UserPlaylistPage.css";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Download, Edit3, GripVertical, MoreHorizontal, Save, Trash2, X } from "lucide-react";
import { api, type UserPlaylist, type Video } from "../api";
import VideoCard from "../components/VideoCard";
import { VideoGridSkeleton } from "../components/LoadingState";
import { PlaylistIcon, PlaylistIconPicker } from "../components/PlaylistIcon";
import Popconfirm from "../components/Popconfirm";
import { emit } from "../events";
import { formatVideoCount, useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { Button, EmptyState, IconButton, Input, LocalToast, Menu, MenuItem, MenuSeparator, PageHeader, Popover, SelectMenu } from "../components/ui";
import EmptyArt from "../components/illustrations/EmptyArt";
import PlaylistPlaybackActions from "../components/PlaylistPlaybackActions";
import type { PlayVideo, PlaybackQueueContext } from "../playbackQueue";
import { normalizeUserPlaylistSort, type UserPlaylistSort } from "../playlistSort";
import { movedItem } from "../playlistReorder";

export default function UserPlaylistPage({ onPlay }: { onPlay: PlayVideo }) {
  const { t, language } = useI18n();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const sort = normalizeUserPlaylistSort(searchParams.get("sort"));
  const playlistId = Number(id);
  const [playlist, setPlaylist] = useState<UserPlaylist | null>(null);
  useDocumentTitle(playlist?.name);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("ListMusic");
  const [downloadPending, setDownloadPending] = useState(false);
  const [downloadFeedback, setDownloadFeedback] = useState("");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [offlinePolicyPending, setOfflinePolicyPending] = useState(false);
  const [carriedVideoId, setCarriedVideoId] = useState<string | null>(null);

  /*
   * Reordering is only meaningful against the playlist's own order: dragging a
   * video up a list sorted by title would move it back the moment the page
   * reloads. So opening the editor shows that order, whatever was being looked
   * at before.
   */
  const reorderable = editing && sort === "playlist-order";
  const startEditing = () => {
    setEditing(true);
    if (sort !== "playlist-order") setSearchParams({ sort: "playlist-order" });
  };

  const carryTo = (videoId: string, toIndex: number) => {
    setVideos((current) => {
      const from = current.findIndex((video) => video.video_id === videoId);
      return from < 0 || from === toIndex ? current : movedItem(current, from, toIndex);
    });
  };

  const dropCarried = async () => {
    const carried = carriedVideoId;
    setCarriedVideoId(null);
    if (!carried || !playlist) return;
    // The list on screen is the order; it is sent whole, and what comes back
    // is what the server actually holds.
    const asked = videos.map((video) => video.video_id);
    try {
      const answer = await api.reorderUserPlaylist(playlist.id, asked);
      if (answer.video_ids.join("\u0000") !== asked.join("\u0000")) load();
    } catch {
      load();
    }
  };

  /*
   * The pointer is followed on the window rather than on the grip.
   *
   * A grip that captures the pointer stops hearing about it the moment the
   * list reorders under it — the card it belongs to has moved, and the drop
   * that should have saved the new order never arrives, so the list springs
   * back on the next load. The window hears every move and the release, and
   * knows nothing about which card is where.
   */
  useEffect(() => {
    if (!carriedVideoId) return;
    const over = (event: PointerEvent) => {
      const under = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-playlist-index]");
      const index = Number(under?.dataset.playlistIndex);
      if (Number.isInteger(index)) carryTo(carriedVideoId, index);
    };
    const drop = () => { void dropCarried(); };
    window.addEventListener("pointermove", over);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", drop);
    return () => {
      window.removeEventListener("pointermove", over);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", drop);
    };
  });

  const load = useCallback(async () => {
    if (!playlistId) return;
    setLoading(true);
    try {
      const r = await api.userPlaylist(playlistId, sort);
      setPlaylist(r.playlist);
      setVideos(r.videos);
      setName(r.playlist.name);
      setIcon(r.playlist.icon);
      setLoading(false);
    } catch (error) {
      console.error(error);
    }
  }, [playlistId, sort]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!playlist || !name.trim()) return;
    const r = await api.updateUserPlaylist(playlist.id, { name: name.trim(), icon });
    setPlaylist(r.playlist);
    setEditing(false);
  };

  const removePlaylist = async () => {
    if (!playlist) return;
    await api.deleteUserPlaylist(playlist.id);
    emit("playlists-changed");
    navigate("/");
  };

  const downloadAll = async () => {
    if (!playlist) return;
    if (!videos.some((video) => video.downloads_enabled)) { navigate("/downloads?view=configuration"); return; }
    setDownloadPending(true); setDownloadFeedback("");
    try {
      const result = await api.downloadUserPlaylist(playlist.id, sort);
      setDownloadFeedback(result.queued > 0 ? t("playlistDownloadQueued", { count: result.queued }) : t("playlistDownloadNone"));
      await load();
    } catch { setDownloadFeedback(t("playlistDownloadFailed")); }
    finally { setDownloadPending(false); }
  };

  const changeOfflinePolicy = async (offline_policy: UserPlaylist["offline_policy"]) => {
    if (!playlist || offlinePolicyPending) return;
    setOfflinePolicyPending(true);
    setDownloadFeedback("");
    try {
      const result = await api.updateUserPlaylist(playlist.id, { offline_policy });
      setPlaylist(result.playlist);
      setDownloadFeedback(t(offline_policy === "none" ? "playlistOfflineDisabled" : offline_policy === "download" ? "playlistOfflineEnabled" : "playlistKeepOfflineEnabled"));
      await load();
    } catch {
      setDownloadFeedback(t("playlistOfflineFailed"));
    } finally {
      setOfflinePolicyPending(false);
    }
  };

  const canDownloadPlaylist = videos.length > 0 && videos.some((video) => video.downloads_allowed);
  const sortAction = <SelectMenu
    floating
    label={t("playlistSort")}
    value={sort}
    onChange={(next: UserPlaylistSort) => setSearchParams({ sort: next }, { replace: true })}
    options={[
      { value: "playlist-order", label: t("playlistSortOrder") },
      { value: "added-newest", label: t("playlistSortAddedNewest") },
      { value: "added-oldest", label: t("playlistSortAddedOldest") },
      { value: "newest", label: t("playlistSortNewest") },
      { value: "oldest", label: t("playlistSortOldest") },
      { value: "title-asc", label: t("playlistSortTitleAsc") },
      { value: "title-desc", label: t("playlistSortTitleDesc") },
    ]}
  />;
  const offlineAction = <SelectMenu
    floating
    disabled={offlinePolicyPending}
    label={t("playlistOfflinePolicy")}
    value={playlist?.offline_policy ?? "none"}
    onChange={changeOfflinePolicy}
    options={[
      { value: "none", label: t("playlistOfflineNone") },
      { value: "download", label: t("playlistOfflineDownload") },
      { value: "keep", label: t("playlistOfflineKeep") },
    ]}
  />;
  if (!playlist && loading) return <VideoGridSkeleton gridSize="sm" />;
  if (!playlist) return null;
  const playbackQueue: PlaybackQueueContext = { version: 1, kind: "user-playlist", playlistUuid: playlist.portable_uuid, sort };
  // Opening a list is not resuming a video: what is remembered for an entry
  // belongs to the last time it was watched on its own.
  const playPlaylistVideo = (video: Video, audio?: boolean) => onPlay(video, playbackQueue, { fromStart: true, audio });
  const downloadMenuItem = !canDownloadPlaylist ? null : videos.some((video) => video.downloads_enabled)
    ? <Popconfirm
        triggerClassName="ui-menu__popover-trigger"
        message={t("playlistDownloadConfirm", { count: videos.length })}
        onConfirm={() => { setActionsOpen(false); void downloadAll(); }}
      >
        <MenuItem disabled={downloadPending} icon={<Download />}>{t("playlistDownloadAll")}</MenuItem>
      </Popconfirm>
    : <MenuItem icon={<Download />} onClick={() => { setActionsOpen(false); void downloadAll(); }}>{t("playlistDownloadAll")}</MenuItem>;
  const moreActions = <Popover
    align="end"
    surface="menu"
    open={actionsOpen}
    onOpenChange={setActionsOpen}
    trigger={<IconButton variant={actionsOpen ? "secondary" : "ghost"} label={t("moreActions")} icon={<MoreHorizontal />} />}
  >
    <Menu>
      {downloadMenuItem}
      {!editing && <MenuItem icon={<Edit3 />} onClick={() => { setActionsOpen(false); startEditing(); }}>{t("edit")}</MenuItem>}
      {(downloadMenuItem !== null || !editing) && <MenuSeparator />}
      <Popconfirm
        triggerClassName="ui-menu__popover-trigger"
        message={t("confirmDelete", { name: playlist.name })}
        onConfirm={() => { setActionsOpen(false); void removePlaylist(); }}
      >
        <MenuItem icon={<Trash2 />}>{t("deletePlaylist")}</MenuItem>
      </Popconfirm>
    </Menu>
  </Popover>;

  return (
    <>
      {editing ? (
        <div className="playlist-header">
          <div className="playlist-title-wrap">
            <div className="playlist-edit-row">
              <PlaylistIconPicker value={icon} onChange={setIcon} />
              <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
              <Button variant="primary" leadingIcon={<Save />} onClick={save}>{t("save")}</Button>
              <IconButton label={t("cancel")} icon={<X />} onClick={() => setEditing(false)} />
            </div>
          </div>
          <div className="playlist-actions">
            <PlaylistPlaybackActions videos={videos} disabled={loading} onPlay={playPlaylistVideo} />
            {offlineAction}
            {sortAction}
            {downloadFeedback && <LocalToast>{downloadFeedback}</LocalToast>}
            {moreActions}
          </div>
        </div>
      ) : (
        <PageHeader
          icon={<div className="playlist-icon"><PlaylistIcon icon={playlist.icon} /></div>}
          title={playlist.name}
          description={formatVideoCount(playlist.video_count, language)}
          actions={<>
            <PlaylistPlaybackActions videos={videos} disabled={loading} onPlay={playPlaylistVideo} />
            {offlineAction}
            {sortAction}
            {downloadFeedback && <LocalToast>{downloadFeedback}</LocalToast>}
            {moreActions}
          </>}
        />
      )}

      {loading && videos.length === 0 ? (
        <VideoGridSkeleton gridSize="sm" />
      ) : videos.length === 0 ? (
        <EmptyState art={<EmptyArt scene="playlistEmpty" />} title={t("playlistIsEmpty")} description={t("playlistIsEmptyHint")} />
      ) : (
        <div className={`video-grid video-grid--sm${reorderable ? " video-grid--reordering" : ""}`}>
          {videos.map((v, index) => (
            <div
              key={v.video_id}
              className={`playlist-video${reorderable ? " playlist-video--reorderable" : ""}${carriedVideoId === v.video_id ? " is-carried" : ""}`}
              data-playlist-index={reorderable ? index : undefined}
            >
              {reorderable && <button
                type="button"
                className="playlist-video__grip"
                aria-label={t("playlistReorderHint")}
                title={t("playlistReorderHint")}
                onPointerDown={(event) => { event.preventDefault(); setCarriedVideoId(v.video_id); }}
              ><GripVertical size={16} /></button>}
              <VideoCard
                video={v}
                onPlay={playPlaylistVideo}
                onChanged={load}
                onRemoveFromPlaylist={(videoId) => api.removeVideoFromUserPlaylist(playlist.id, videoId)}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
