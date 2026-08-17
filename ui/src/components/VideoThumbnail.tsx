import { Check } from "lucide-react";
import { type ReactNode, useState } from "react";
import { img } from "../img";
import "./VideoThumbnail.css";

export type VideoThumbnailVariant =
  | "card"
  | "search"
  | "related"
  | "playlist"
  | "scheduled"
  | "external"
  | "sidebar"
  | "childWatching";

const VARIANT_CLASSES: Record<VideoThumbnailVariant, { frame: string; image: string }> = {
  card: { frame: "video-card-thumbnail", image: "thumb" },
  search: { frame: "yt-result-thumb", image: "" },
  related: { frame: "thumb-wrap related-thumb", image: "" },
  playlist: { frame: "playlist-item-thumb", image: "" },
  scheduled: { frame: "scheduled-thumb-frame", image: "scheduled-thumb" },
  external: { frame: "external-thumb-frame", image: "external-thumb" },
  sidebar: { frame: "sidebar-sub-thumb-frame", image: "sidebar-sub-thumb" },
  childWatching: { frame: "child-watching-thumb", image: "" },
};

export function watchProgress(position: number | null | undefined, duration: number | null | undefined): number | null {
  if (position == null || duration == null || duration <= 0 || position <= 0) return null;
  return Math.min(1, Math.max(0, position / duration));
}

function PlaybackIndicator({ watched, progress }: { watched: boolean; progress?: number | null }) {
  const normalizedProgress = watched ? 1 : progress == null ? null : Math.min(1, Math.max(0, progress));
  if (normalizedProgress == null || normalizedProgress <= 0) return null;
  return (
    <>
      {watched && (
        <span className="watched-check-badge" aria-hidden="true">
          <Check size={13} strokeWidth={3} />
        </span>
      )}
      <span className="watched-progress-bar" aria-hidden="true">
        <span className="progress-bar-fill" style={{ width: `${normalizedProgress * 100}%` }} />
      </span>
    </>
  );
}

export function VideoThumbnail({
  src,
  watched,
  progress,
  variant,
  alt = "",
  loading,
  draggable,
  fallbackSrc,
  children,
}: {
  src: string;
  watched: boolean;
  progress?: number | null;
  variant: VideoThumbnailVariant;
  alt?: string;
  loading?: "eager" | "lazy";
  draggable?: boolean;
  /** Shown when `src` renders nothing — a replacement that came back empty. */
  fallbackSrc?: string;
  children?: ReactNode;
}) {
  const classes = VARIANT_CLASSES[variant];
  /*
   * A replacement image that renders nothing must not leave a hole.
   *
   * DeArrow generates its frames on demand and answers 204 while it has none —
   * which is every video too new for anyone to have asked before, and any video
   * at all while the service is busy. The <img> then draws a broken placeholder
   * where a thumbnail belongs. The uploader's image is still perfectly good, so
   * it is what a failed replacement falls back to.
   */
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const shown = fallbackSrc && failedSrc === src ? fallbackSrc : src;
  const watchedClass = watched ? " watched-thumbnail--watched" : "";
  const progressClass = watched || (progress != null && progress > 0) ? " watched-thumbnail--has-progress" : "";
  return (
    <span className={`video-thumbnail watched-thumbnail ${classes.frame}${watchedClass}${progressClass}`}>
      <img
        className={`video-thumbnail-image watched-thumbnail-image ${classes.image}`.trim()}
        src={img(shown)}
        alt={alt}
        loading={loading}
        draggable={draggable}
        onError={() => { if (fallbackSrc && failedSrc !== src) setFailedSrc(src); }}
      />
      {children}
      <PlaybackIndicator watched={watched} progress={progress} />
    </span>
  );
}
