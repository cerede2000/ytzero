import { Check } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { img } from "../img";
import { pendingRetry, shownThumbnail, thumbnailCandidates } from "../thumbnailFallback";
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
  const [painted, setPainted] = useState<string | null>(null);
  const candidates = thumbnailCandidates(src, fallbackSrc);
  const wanted = candidates.find((candidate) => !failed.includes(candidate)) ?? candidates[0];
  /*
   * A card that already shows something never blinks through empty.
   *
   * Setting a new `src` empties the element until the replacement decodes, and
   * these cards get a second URL a moment after the first: DeArrow's answer
   * arrives after the page has settled, so every thumbnail on screen went
   * blank and came back. The replacement is loaded out of sight and swapped in
   * once it is ready — the reader sees one image become another, or nothing at
   * all happen. Only the first paint is immediate, because a card waiting on a
   * preload is a card showing nothing.
   */
  const shown = shownThumbnail(painted, wanted);
  useEffect(() => {
    if (!painted || painted === wanted) return;
    let abandoned = false;
    const probe = new Image();
    probe.onload = () => { if (!abandoned) setPainted(wanted); };
    probe.onerror = () => {
      if (!abandoned) setFailed((previous) => previous.includes(wanted) ? previous : [...previous, wanted]);
    };
    probe.src = img(wanted);
    return () => { abandoned = true; };
  }, [painted, wanted]);
  /*
   * A frame that was not ready is asked for once more, quietly. Lifting the
   * failure is all this does — the preload above is what decides whether the
   * card changes, so a second refusal costs the reader nothing.
   */
  const pending = pendingRetry(failed, retried);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => {
      setRetried((previous) => [...previous, pending]);
      setFailed((previous) => previous.filter((url) => url !== pending));
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
        onLoad={() => setPainted(shown)}
        onError={() => setFailed((previous) => previous.includes(shown) ? previous : [...previous, shown])}
      />
      {children}
      <PlaybackIndicator watched={watched} progress={progress} />
    </span>
  );
}
