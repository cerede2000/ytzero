/**
 * The page a client asked for.
 *
 * Every list in this dialect is paged the same way — one-based, opaque to the
 * client — and a route that takes the parameter and ignores it is worse than
 * one that never offered it: the client asks for page two, receives page one
 * again, decides there is more, and walks the same videos for as long as
 * somebody keeps scrolling.
 */
export function pageNumber(asked: string | undefined): number {
  const page = Math.trunc(Number(asked));
  return Number.isFinite(page) && page > 1 ? page : 1;
}
