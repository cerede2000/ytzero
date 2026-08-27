/**
 * A list with one entry carried to another place in it.
 *
 * Dragging is a sequence of these, one per card the pointer crosses, so it has
 * to be exact: an index that lands one short leaves the card trailing the
 * pointer, and one that lands one long makes it jump ahead and flicker between
 * two places for the rest of the drag.
 */
export function movedItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length) return [...items];
  const target = Math.min(Math.max(to, 0), items.length - 1);
  const next = [...items];
  const [carried] = next.splice(from, 1);
  next.splice(target, 0, carried);
  return next;
}
