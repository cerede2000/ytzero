import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDownToLine, ListPlus, ListX } from "lucide-react";
import { api, type Video } from "../api";
import { useI18n } from "../i18n";
import { addToSessionQueue, entryFromVideo, removeFromSessionQueue, useInSessionQueue } from "../sessionQueue";
import Tooltip from "./Tooltip";

/**
 * Queue and download, for a card that is not a VideoCard.
 *
 * The panel beside a video draws its own compact rows rather than full cards,
 * and grew them without these two — so a suggestion could be opened or
 * scheduled, but never queued up behind what was playing, which is the one
 * thing a panel of suggestions is for.
 *
 * VideoCard's copies are woven into its hover, pinning and proximity state, so
 * they are rebuilt here rather than lifted out: the behaviour is a few lines,
 * the coupling is not.
 */
export default function VideoQuickActions({ video }: { video: Video }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queued = useInSessionQueue(video.video_id);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(video.download_status ?? null);

  const toggleQueue = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (queued) { removeFromSessionQueue(video.video_id); return; }
    addToSessionQueue(entryFromVideo(video));
    // A suggestion is a title and a thumbnail until somebody acts on it. Queuing
    // is acting on it, so the import starts now rather than when it is reached.
    if (video.in_library !== 1) api.videoInfo(video.video_id).catch(() => {});
  };

  const download = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    // Downloads off: send the reader to the setting rather than fail silently.
    if (!video.downloads_enabled) { navigate("/downloads?view=configuration"); return; }
    setDownloadStatus("queued");
    api.requestDownload(video.video_id).catch(() => setDownloadStatus(null));
  };

  // A stream that has not finished has nothing to fetch yet.
  const downloadable = video.live_status !== "live" && video.live_status !== "upcoming"
    && video.is_private !== 1
    && (video.downloads_enabled || video.downloads_allowed)
    && downloadStatus !== "done" && downloadStatus !== "queued" && downloadStatus !== "downloading";

  return (
    <div className="related-quick-actions">
      <Tooltip text={queued ? t("removeFromPlayQueue") : t("addToPlayQueue")}>
        <button
          className={`action-btn${queued ? " active" : ""}`}
          aria-pressed={queued}
          aria-label={queued ? t("removeFromPlayQueue") : t("addToPlayQueue")}
          onClick={toggleQueue}
        >{queued ? <ListX /> : <ListPlus />}</button>
      </Tooltip>
      {downloadable && (
        <Tooltip text={video.downloads_enabled ? t("downloadLocally") : t("enableDownloadsFeature")}>
          <button
            className="action-btn"
            aria-label={video.downloads_enabled ? t("downloadLocally") : t("enableDownloadsFeature")}
            onClick={download}
          ><ArrowDownToLine /></button>
        </Tooltip>
      )}
    </div>
  );
}
