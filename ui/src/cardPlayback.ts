import type { Video } from "./apiTypes";

/**
 * Start a video in the mode the card is *not* already offering.
 *
 * Opening a card plays it in whichever mode this profile last chose, so an
 * action that does the same thing again would be a second way to press the
 * thumbnail. What a card is missing is the other one: watching something that
 * was going to be listened to, or putting on the headphones for something that
 * was going to be watched.
 *
 * The choice is written down before navigating rather than argued with the
 * player afterwards — the watch page reads it as it opens, and the videos that
 * follow inherit it, exactly as starting a playlist in audio does.
 */
export function playInOtherMode(
  video: Video,
  remembered: boolean,
  remember: (audio: boolean) => void,
  onPlay: (video: Video) => void,
): boolean {
  const audio = !remembered;
  remember(audio);
  onPlay(video);
  return audio;
}
