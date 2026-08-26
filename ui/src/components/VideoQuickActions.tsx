import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Archive, ArrowDownToLine, Eye, EyeOff, ListPlus, ListX } from "lucide-react";
import { api, type Video } from "../api";
import { useI18n } from "../i18n";
import { SessionPlayQueueAction } from "./SessionPlayQueueAction";
import Tooltip from "./Tooltip";
import { useAppliedVideoCardActionConfig, type VideoCardActionId } from "../videoCardActionConfig";

/**
 * The card actions, for a card that is not a VideoCard.
 *
 * The panel beside a video draws its own compact rows rather than full cards,
 * and grew them without any of these — so a suggestion could be opened or
 * scheduled and nothing else. Not queued behind what was playing, which is the
 * one thing a panel of suggestions is for; not dismissed; not marked as seen.
 *
 * Which of them appear follows the same configuration the cards elsewhere use,
 * rather than a fixed handful chosen here: two lists of actions kept in step by
 * hand is one list too many.
 *
 * VideoCard's own copies are woven into its hover, pinning and proximity state,
 * so they are rebuilt here rather than lifted out: the behaviour is a few lines,
 * the coupling is not.
 */
export default function VideoQuickActions({ video, onChanged }: { video: Video; onChanged?: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [downloadStatus, setDownloadStatus] = useState<string | null>(video.download_status ?? null);
  const [state, setState] = useState<{ archived: boolean; watched: boolean }>({
    archived: video.status === "archived",
    watched: video.watched === 1,
  });
  // The same set the cards elsewhere are configured with. A panel that offered
  // its own fixed handful would be one more place to keep in step by hand.
  const config = useAppliedVideoCardActionConfig();
  const shown = new Set<VideoCardActionId>(
    config.actions.filter((action) => !action.hidden).map((action) => action.id),
  );

  const act = async (event: React.MouseEvent, run: () => Promise<unknown>, next: Partial<typeof state>) => {
    event.preventDefault();
    event.stopPropagation();
    const previous = state;
    setState({ ...state, ...next });
    try {
      await run();
      onChanged?.();
    } catch {
      // A suggestion has no library row until its import finishes, and that
      // import is what these endpoints now do first. If it fails there is
      // nothing to record, so the card says so rather than claiming otherwise.
      setState(previous);
    }
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
      {shown.has("sessionQueue") && <SessionPlayQueueAction video={video} compact />}
      {downloadable && shown.has("download") && (
        <Tooltip text={video.downloads_enabled ? t("downloadLocally") : t("enableDownloadsFeature")}>
          <button
            className="action-btn"
            aria-label={video.downloads_enabled ? t("downloadLocally") : t("enableDownloadsFeature")}
            onClick={download}
          ><ArrowDownToLine /></button>
        </Tooltip>
      )}
      {shown.has("watched") && (
        <Tooltip text={state.watched ? t("markUnwatched") : t("markWatched")}>
          <button
            className={`action-btn${state.watched ? " active" : ""}`}
            aria-pressed={state.watched}
            aria-label={state.watched ? t("markUnwatched") : t("markWatched")}
            onClick={(event) => act(
              event,
              () => state.watched ? api.markUnwatched(video.video_id) : api.complete(video.video_id),
              { watched: !state.watched },
            )}
          >{state.watched ? <EyeOff /> : <Eye />}</button>
        </Tooltip>
      )}
      {shown.has("archive") && !state.archived && (
        <Tooltip text={t("reject")}>
          <button
            className="action-btn"
            aria-label={t("reject")}
            onClick={(event) => act(event, () => api.archiveVideo(video.video_id), { archived: true })}
          ><Archive /></button>
        </Tooltip>
      )}
    </div>
  );
}
