import { useSyncExternalStore } from "react";
import { emit, subscribe } from "./events";
import type { Video } from "./apiTypes";

/**
 * A play queue that lasts as long as the browsing does.
 *
 * Building a list of things to watch usually means committing to it: naming a
 * playlist before knowing whether it is worth keeping. This one is gathered
 * while browsing and thrown away with the tab — sessionStorage is what makes
 * that true rather than promised, since it survives a reload and nothing more.
 * A queue worth keeping can still be written down as a real playlist.
 */
export interface SessionQueueEntry {
  videoId: string;
  title: string;
  thumbnail: string;
  channelTitle: string;
  duration: string | null;
}

export const SESSION_QUEUE_KEY = "ytzero.play-queue";
const CHANGE_EVENT = "session-queue";
/** Enough for an evening; a bound is what keeps a runaway list out of storage. */
export const SESSION_QUEUE_LIMIT = 200;

function isEntry(value: unknown): value is SessionQueueEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<SessionQueueEntry>;
  return typeof entry.videoId === "string" && entry.videoId.length > 0
    && typeof entry.title === "string"
    && typeof entry.thumbnail === "string"
    && typeof entry.channelTitle === "string"
    && (entry.duration === null || typeof entry.duration === "string");
}

export function parseSessionQueue(raw: string | null): SessionQueueEntry[] {
  if (!raw) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: SessionQueueEntry[] = [];
  for (const item of value) {
    if (!isEntry(item) || seen.has(item.videoId)) continue;
    seen.add(item.videoId);
    entries.push(item);
    if (entries.length === SESSION_QUEUE_LIMIT) break;
  }
  return entries;
}

/**
 * The queue with this video in it.
 *
 * Adding one that is already queued leaves the list exactly as it is: the
 * order is the order things were chosen in, and a second tap should not
 * quietly move an entry to the end of it.
 */
export function withEntry(queue: readonly SessionQueueEntry[], entry: SessionQueueEntry): SessionQueueEntry[] {
  if (queue.some((item) => item.videoId === entry.videoId)) return [...queue];
  return [...queue, entry].slice(-SESSION_QUEUE_LIMIT);
}

export function withoutEntry(queue: readonly SessionQueueEntry[], videoId: string): SessionQueueEntry[] {
  return queue.filter((item) => item.videoId !== videoId);
}

/**
 * The queued video, as a card can draw it, without asking the library.
 *
 * A suggestion queued from the panel has no library row until its import
 * finishes — and that import is only started by the queuing itself. Anything
 * that waited for the row was therefore blank for the seconds that mattered:
 * the "next" button did not appear at the moment somebody said what should
 * play next, which is the moment it exists for.
 *
 * The queue already holds what it queued. Enough of it, at least, to name and
 * picture the video; the rest arrives with the row.
 */
export function videoFromSessionEntry(entry: SessionQueueEntry): Video {
  return {
    video_id: entry.videoId,
    title: entry.title,
    thumbnail: entry.thumbnail,
    channel_title: entry.channelTitle,
    duration: entry.duration,
    channel_id: "",
    description: "",
    published_at: "",
    found_at: "",
    published_at_approximate: 1,
    members_only: 0,
    is_private: 0,
    live_status: "none",
    status: "inbox",
    bucket: null,
    show_from: null,
    is_short: 0,
    views: null,
    likes: null,
    watch_position: null,
    watch_duration: null,
    in_history: 0,
    external: 1,
    liked: 0,
    watched: 0,
    channel_thumbnail: null,
    channel_subscriber_count: null,
    tags: [],
  } as unknown as Video;
}

export function entryFromVideo(video: Video): SessionQueueEntry {
  return {
    videoId: video.video_id,
    title: video.title,
    thumbnail: video.thumbnail,
    channelTitle: video.channel_title,
    duration: video.duration,
  };
}

// Read once and kept, so every subscriber is handed the same array and React
// stops re-rendering on identity alone.
let cache: SessionQueueEntry[] | null = null;
let serialized = "";

function store(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

export function readSessionQueue(): SessionQueueEntry[] {
  // Compared as a string, absent included: an empty queue that answered with a
  // fresh array every time is a render that never settles.
  const raw = store()?.getItem(SESSION_QUEUE_KEY) ?? "";
  if (cache !== null && raw === serialized) return cache;
  serialized = raw;
  cache = parseSessionQueue(raw);
  return cache;
}

function write(next: SessionQueueEntry[]) {
  serialized = JSON.stringify(next);
  cache = next;
  try { store()?.setItem(SESSION_QUEUE_KEY, serialized); } catch { /* private mode: the queue lives for this page only */ }
  emit(CHANGE_EVENT);
}

export function addToSessionQueue(entry: SessionQueueEntry) {
  write(withEntry(readSessionQueue(), entry));
}

export function removeFromSessionQueue(videoId: string) {
  write(withoutEntry(readSessionQueue(), videoId));
}

export function clearSessionQueue() {
  write([]);
}

export function isInSessionQueue(videoId: string): boolean {
  return readSessionQueue().some((entry) => entry.videoId === videoId);
}

const listen = (notify: () => void) => subscribe(CHANGE_EVENT, notify);

export function useSessionQueue(): SessionQueueEntry[] {
  return useSyncExternalStore(listen, readSessionQueue, () => EMPTY);
}

const EMPTY: SessionQueueEntry[] = [];

/**
 * Whether this one video is queued.
 *
 * A card asks about itself rather than reading the whole queue: the answer is
 * a boolean, so adding a video redraws the card that changed instead of every
 * card on the page.
 */
export function useInSessionQueue(videoId: string): boolean {
  return useSyncExternalStore(listen, () => isInSessionQueue(videoId), () => false);
}
