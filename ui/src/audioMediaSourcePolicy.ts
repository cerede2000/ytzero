/**
 * Whether to go straight to the plain file instead of a playlist.
 *
 * A video that has been downloaded is already on disk, whole: it needs no
 * index to seek through and nothing from YouTube to play. The playlist is for
 * a track being read from YouTube as it goes.
 */
export function shouldStartProgressive({
  live,
  playlistSrc,
  progressiveSrc,
}: {
  live: boolean;
  playlistSrc: string;
  progressiveSrc?: string;
}): boolean {
  // A broadcast has no whole file to read: it is a playlist by nature.
  return !live && !playlistSrc && Boolean(progressiveSrc);
}

export function shouldFallbackFromHlsJs({
  hasProgressiveSource,
  live,
  sourceReady,
  status,
}: {
  hasProgressiveSource: boolean;
  live: boolean;
  sourceReady: boolean;
  status: number | undefined;
}): boolean {
  return hasProgressiveSource && !live && !sourceReady && status === 404;
}

export function shouldFallbackFromNativeHls({
  hasProgressiveSource,
  live,
  sourceReady,
}: {
  hasProgressiveSource: boolean;
  live: boolean;
  sourceReady: boolean;
}): boolean {
  // Native media errors do not expose the manifest HTTP status. Falling back
  // is safe only before HLS has produced metadata; later errors belong to an
  // already selected source and must surface through the normal retry flow.
  return hasProgressiveSource && !live && !sourceReady;
}
