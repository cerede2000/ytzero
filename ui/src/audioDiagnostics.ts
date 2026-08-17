/**
 * Report what the audio player did, from a device with no console.
 *
 * The lock-screen controls vanish on Android while the sound plays on, and the
 * mechanism does not reproduce on a desktop: there the element pauses, so
 * neither the stall watcher nor a source rebuild ever fires. Two readings of the
 * code produced two wrong answers, so this reports facts instead.
 *
 * Fire and forget, and silent on failure: a diagnostic that can break playback
 * is worse than no diagnostic.
 */
export type AudioDiagnosticEvent =
  | "session_torn_down_while_playing"
  | "source_rebuilt"
  | "stall_recovery"
  | "visibility";

export function reportAudioDiagnostic(
  event: AudioDiagnosticEvent,
  videoId: string,
  detail: Record<string, string | number | boolean | null> = {},
): void {
  try {
    void fetch("/api/diagnostics/audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, videoId, detail: { visibility: document.visibilityState, ...detail } }),
      // The page is often being hidden as this fires, which is exactly when an
      // ordinary request is dropped.
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Never let reporting a problem become one.
  }
}
