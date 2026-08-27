/**
 * The queue this fork used to keep, handed to the one upstream keeps.
 *
 * Both hold the same thing in `sessionStorage` — the list assembled in a tab
 * and thrown away with it — but under different names and shapes. When our own
 * implementation gave way to upstream's, a queue already sitting in a reader's
 * tab stayed where it was and the menu, now reading the other name, showed
 * nothing. Nothing was deleted; it simply stopped being looked at.
 *
 * So it is looked at once, on the way in, and only when upstream's is empty:
 * whatever is found is converted and written where the menu will find it, and
 * the old name is cleared so this never happens twice.
 */
const OURS = "ytzero.play-queue";
const THEIRS = "ytzero.session-play-queue.v1";

interface AdoptedItem { video_id: string; title: string; thumbnail: string; channel_title: string }

export function adoptedItems(raw: string | null): AdoptedItem[] {
  if (!raw) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: AdoptedItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const old = entry as Record<string, unknown>;
    const videoId = typeof old.videoId === "string" ? old.videoId : "";
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);
    items.push({
      video_id: videoId,
      title: typeof old.title === "string" ? old.title : "",
      thumbnail: typeof old.thumbnail === "string" ? old.thumbnail : "",
      channel_title: typeof old.channelTitle === "string" ? old.channelTitle : "",
    });
  }
  return items;
}

export function adoptSessionQueue(storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null): number {
  if (!storage) return 0;
  try {
    const existing = storage.getItem(THEIRS);
    const mine = storage.getItem(OURS);
    if (!mine) return 0;
    // Upstream's queue wins wherever it holds anything: the reader has been
    // using it since, and the older list is the stale one.
    const held = existing ? (JSON.parse(existing) as { items?: unknown })?.items : null;
    if (Array.isArray(held) && held.length > 0) { storage.removeItem(OURS); return 0; }
    const items = adoptedItems(mine);
    if (items.length > 0) storage.setItem(THEIRS, JSON.stringify({ version: 1, items }));
    storage.removeItem(OURS);
    return items.length;
  } catch {
    return 0;
  }
}

try { adoptSessionQueue(globalThis.sessionStorage ?? null); } catch { /* a tab that refuses storage has no queue to carry over */ }
