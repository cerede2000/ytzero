/**
 * The order a playlist is put in.
 *
 * The client sends the whole order rather than a move, because a move is only
 * meaningful against the list the reader was looking at: two tabs, or a video
 * added while one of them was open, and "third from the top" is somewhere else
 * by the time it arrives. A whole order says what it wants without depending
 * on what was there a moment ago.
 *
 * What it may not do is add or drop anything. Anything the playlist holds and
 * the order does not name keeps its place at the end, in the order it already
 * had — a video added in another tab is not thrown away by a reorder that
 * never knew about it.
 */
export function orderedPlaylistVideoIds(asked: readonly unknown[], held: readonly string[]): string[] {
  const inPlaylist = new Set(held);
  const placed: string[] = [];
  const seen = new Set<string>();
  for (const candidate of asked) {
    if (typeof candidate !== "string" || !inPlaylist.has(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    placed.push(candidate);
  }
  for (const videoId of held) if (!seen.has(videoId)) placed.push(videoId);
  return placed;
}
