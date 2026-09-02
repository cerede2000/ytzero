export function normalizePlaylistSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/ł/g, "l")
    .trim();
}

export function filterPlaylistsByName<T extends { name: string }>(playlists: readonly T[], query: string): T[] {
  const needle = normalizePlaylistSearch(query);
  if (!needle) return [...playlists];
  return playlists.filter((playlist) => normalizePlaylistSearch(playlist.name).includes(needle));
}

export function movePlaylistSearchIndex(current: number, count: number, direction: "next" | "previous"): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return direction === "next" ? 0 : count - 1;
  return direction === "next" ? (current + 1) % count : (current - 1 + count) % count;
}
