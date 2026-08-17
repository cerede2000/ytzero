/**
 * What the system controls should be told about playback, right now.
 *
 * The media session is re-registered whenever what it can reach changes — a new
 * neighbour in the list, a new title. Its cleanup declares the session over
 * (`playbackState = "none"`, every handler removed), which is right on unmount
 * and wrong on a re-run: the element has not stopped, and Android takes the
 * declaration at its word and drops the lock-screen controls.
 *
 * Re-registering the handlers does not bring them back, because the state is
 * still "none" and nothing will correct it: `playbackState = "playing"` was only
 * ever written by the element's own `play` event, and the element never paused,
 * so it never fires one. The controls stay gone until the track changes.
 *
 * Which is why the state has to be re-stated from the element every time the
 * session is registered, rather than left to an event that has already happened.
 */
export function mediaPlaybackState(audio: { paused: boolean; ended: boolean } | null | undefined): MediaSessionPlaybackState {
  if (!audio) return "none";
  if (audio.ended) return "none";
  return audio.paused ? "paused" : "playing";
}
