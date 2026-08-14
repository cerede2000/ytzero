export type WatchSourceMode = "youtube" | "ask" | "download";
export type SourceChoice = "undecided" | "remote" | "wait";
export type PlayerKind = "loading" | "local" | "youtube" | "direct" | "blocked" | "choice" | "waiting" | "stream";

export function shouldFallbackToDirectStream(errorCode: number | null): boolean {
  return errorCode === 100 || errorCode === 101 || errorCode === 150;
}

export function shouldLatchCompletedDownload(
  playerKind: PlayerKind,
  previousStatus: string | null,
  nextStatus: string | null,
): boolean {
  if (nextStatus !== "done") return false;
  if (playerKind === "stream") return true;
  return playerKind === "youtube" && (previousStatus === "queued" || previousStatus === "downloading");
}

export function resolvePlayerKind(input: {
  hasVideo: boolean;
  isLive: boolean;
  isUpcoming?: boolean;
  downloadStatus: string | null;
  localMediaSource?: "download" | "tubearchivist" | null;
  playerSource: "auto" | "youtube";
  defaultPlayer: "youtube" | "direct";
  directFallback: boolean;
  playbackPolicyReady: boolean;
  childDownloadsOnly: boolean;
  sourceChoice: SourceChoice;
  watchMode: WatchSourceMode;
  streamingEnabled: boolean;
  keepStreamingAfterDownload: boolean;
  // "youtube" = embed first (drop to the direct stream only if it can't play);
  // "stream" = the experimental stream first. Defaults to "youtube".
  defaultSource?: "youtube" | "stream";
  // The YouTube embed reported it can't play (embedding disabled / unavailable).
  iframeFallback?: boolean;
  // The row this page is about is not here yet, and is being fetched.
  playerPending?: boolean;
}): PlayerKind {
  // Every branch below falls through to the embed when there is no row, and
  // the embed is the wrong answer twice over: it mounts an empty black frame
  // while an import runs, and it plays a second of video at a listener whose
  // audio mode cannot be judged yet. Wait instead — the panel says so.
  if (input.playerPending) return "loading";
  const canStream = input.hasVideo && input.streamingEnabled && input.playerSource === "auto" && input.sourceChoice !== "youtube";
  // A live broadcast has no stable local file. When streaming is on we play it in
  // the native player (via YouTube's own rolling HLS), which — unlike the iframe —
  // can go Picture-in-Picture / background. An *upcoming* (not-yet-started) stream
  // has nothing to play, and without streaming we fall back to the iframe.
  if (input.hasVideo && input.isLive) return canStream && !input.isUpcoming ? "stream" : "youtube";
  // Finishing the background download must not tear down a stream that is
  // already playing. The viewer explicitly hands off to the local file.
  if (canStream && input.keepStreamingAfterDownload && input.downloadStatus === "done") return "stream";
  // The fast background download finished: switch to the local file, which
  // seeks natively and perfectly (the streaming path hands off to it here).
  if (input.hasVideo && (input.downloadStatus === "done" || input.localMediaSource === "tubearchivist") && input.playerSource === "auto") return "local";
  if (!input.playbackPolicyReady) return "loading";
  // An external video is being imported. Do not mount the YouTube iframe in
  // the short gap before its library row arrives: it can only claim that the
  // video is unavailable, while streaming will take over as soon as it does.
  if (!input.hasVideo && streamEligible) return "loading";
  if (input.hasVideo && input.childDownloadsOnly) return "blocked";
  // A video with no muxed/progressive format routes here (sourceChoice "wait") to
  // download-and-play; checked first so it works whichever default is set.
  if (input.hasVideo && input.sourceChoice === "wait") return "waiting";
  // When streaming applies, the default source decides: "stream" opens on the
  // stream; "youtube" (default) uses the embed and only drops to a stream when
  // the embed can't play (iframeFallback). With streaming off, the watchMode
  // preference below takes over.
  if (canStream) {
    if ((input.defaultSource ?? "youtube") === "stream") return "stream";
    if (input.iframeFallback) return "stream";
    return "youtube";
  }
  if (input.hasVideo && input.watchMode === "download" && input.sourceChoice !== "youtube") return "waiting";
  if (input.hasVideo && input.watchMode === "ask" && input.sourceChoice === "undecided") return "choice";
  if (input.hasVideo && !remoteForcedToYouTube && (input.directFallback || (wantsRemote && input.defaultPlayer === "direct"))) return "direct";
  return "youtube";
}
