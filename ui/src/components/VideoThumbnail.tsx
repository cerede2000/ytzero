import { Check } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { img } from "../img";
import { pendingRetry, thumbnailCandidates } from "../thumbnailFallback";
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

/**
 * Long enough for DeArrow to have rendered the frame this card's first request
 * asked it for, short enough that the reader is still on the page.
 */
const RETRY_AFTER_MS = 20_000;

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
   * An image that renders nothing must not leave a hole.
   *
   * DeArrow generates its frames on demand and answers 204 while it has none —
   * every video too new for anyone to have asked before, and any video at all
   * while the service is busy. The uploader's image stands in for that. But the
   * uploader's image can be gone too: a designed thumbnail is served under a
   * numbered name that rotates when it is changed, and the stored URL then
   * answers 404 for good. Both fall through to the plain name, which does not
   * rotate. Each candidate is tried once, in order.
   */
  const [failed, setFailed] = useState<readonly string[]>([]);
  const [retried, setRetried] = useState<readonly string[]>([]);
  const candidates = thumbnailCandidates(src, fallbackSrc);
  const shown = candidates.find((candidate) => !failed.includes(candidate)) ?? candidates[0];
  /*
   * A frame that was not ready is asked for once more, quietly.
   *
   * The retry loads into an image nobody is looking at, and the card only
   * changes if it works — a reader watching a thumbnail settle is worse than
   * one looking at the uploader's image a moment longer.
   */
  const pending = pendingRetry(failed, retried);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => {
      const probe = new Image();
      probe.onload = () => {
        setRetried((previous) => [...previous, pending]);
        setFailed((previous) => previous.filter((url) => url !== pending));
      };
      probe.onerror = () => setRetried((previous) => [...previous, pending]);
      probe.src = img(pending);
    }, RETRY_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);
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
        onError={() => setFailed((previous) => previous.includes(shown) ? previous : [...previous, shown])}
      />
      {children}
      <PlaybackIndicator watched={watched} progress={progress} />
    </span>
  );
}
