import { ArrowDownToLine, LoaderCircle, X } from "lucide-react";
import "./WatchStreamUpgrade.css";

/**
 * The direct stream plays whatever YouTube offers progressively (360p/720p).
 * This offers the full-quality download on top of it, and while that download
 * runs it turns into its progress — clicking then cancels and simply keeps
 * streaming, leaving nothing on disk.
 */
export default function WatchStreamUpgrade({
  downloading,
  percent,
  visible,
  downloadLabel,
  cancelLabel,
  onDownload,
  onCancel,
}: {
  downloading: boolean;
  percent: number | null;
  visible: boolean;
  downloadLabel: string;
  cancelLabel: string;
  onDownload: () => void;
  onCancel: () => void;
}) {
  const className = `watch-stream-upgrade${visible ? "" : " watch-stream-upgrade--hidden"}`;
  if (downloading) {
    return (
      <button type="button" className={className} onClick={onCancel} aria-label={cancelLabel} title={cancelLabel}>
        <LoaderCircle size={16} className="spin" />
        <span>{percent != null ? `${Math.round(percent)}%` : "…"}</span>
        <X size={14} />
      </button>
    );
  }
  return (
    <button type="button" className={className} onClick={onDownload} aria-label={downloadLabel} title={downloadLabel}>
      <ArrowDownToLine size={16} />
      <span>{downloadLabel}</span>
    </button>
  );
}
