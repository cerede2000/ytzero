import { useEffect, type RefObject } from "react";

/**
 * Stop a media element for good when its component goes away.
 *
 * Taking the node out of the document is not enough on iOS: the media load
 * outlives it and carries on fetching and playing. Switching between the video
 * and audio surfaces, or moving to another video, then leaves the previous
 * player audible underneath the new one — and out of reach of the controls,
 * which were rendered with the element that has gone.
 *
 * Only on unmount: releasing on a source change would wipe the src React has
 * just set on the very same element.
 */
export function useMediaRelease(mediaRef: RefObject<HTMLMediaElement | null>): void {
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    return () => {
      try { media.pause(); } catch {}
      media.removeAttribute("src");
      try { media.load(); } catch {}
    };
  }, [mediaRef]);
}
