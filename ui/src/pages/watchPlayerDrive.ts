/**
 * Whether the page still has a player to drive.
 *
 * The YouTube embed is not React's: the IFrame API replaces the element it is
 * given with an iframe of its own. So when the page decides it has nothing to
 * show and swaps that element for a panel, React removes a node that is no
 * longer there and the iframe stays in the document — playing, with sound,
 * behind the notice saying the video could not be loaded.
 *
 * The effect that owns the embed destroys it in its cleanup, and a cleanup
 * only runs when the effect re-runs. So the answer below has to be part of
 * what the effect watches: it is the same question the render asks, asked in
 * the one other place that has to agree with it.
 */
export function shouldDriveYouTubePlayer(state: {
  playerKind: string;
  membersOnlyNotice: boolean;
  videoUnavailable: boolean;
}): boolean {
  if (state.membersOnlyNotice) return false;
  // The panel is showing in its place; there is no element to attach to and
  // nothing left to drive.
  if (state.videoUnavailable) return false;
  return state.playerKind === "youtube";
}
