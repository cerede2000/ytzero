import { database } from "../../database";
import { videoFromRow } from "./shapes";
import type { DetailRow } from "./videoDetail";

/**
 * This library's own playlists, in the shape a client fetches them.
 *
 * They are an account's playlists, not a channel's — which is a different
 * document, a different route, and, as it turns out, a different id.
 */

const VIDEO_COLUMNS = `
  v.video_id, v.title, v.description, v.thumbnail, v.published_at, v.live_status,
  v.views, v.likes, v.duration, v.channel_id,
  COALESCE(c.custom_title, c.title) AS channel_title
`;

/**
 * Why the id starts with `IVPL`.
 *
 * A client decides how to open a playlist from the id alone. Yattee sends the
 * session to `/api/v1/auth/playlists/{id}` when the id starts with `IVPL` —
 * the prefix Invidious puts on the playlists an account owns — and asks the
 * public `/api/v1/playlists/{id}` for anything else. Ours are an account's, so
 * they have to wear that prefix or they are looked for among the channel
 * playlists, where they are not, and open empty.
 *
 * `ytz` behind it keeps them out of the space of real Invidious ids and
 * carries our own number, which is all we need to find the playlist again.
 */
const PREFIX = "IVPLytz";

/** The one place a playlist's number becomes a client's string. */
export function localPlaylistId(id: number): string {
  return `${PREFIX}${id}`;
}

/** Our number back out of a client's string, or nothing when it is not ours. */
export function localPlaylistNumber(playlistId: string): number | null {
  // A client keeps the ids it has seen — in recents, in a queue — so the
  // prefix minted before this one still opens what it names.
  const digits = playlistId.startsWith(PREFIX) ? playlistId.slice(PREFIX.length)
    : playlistId.startsWith("ytz") ? playlistId.slice(3)
    : null;
  if (digits === null || !/^\d+$/.test(digits)) return null;
  const id = Number(digits);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * How much of a playlist one answer carries.
 *
 * Invidious pages playlists by hundreds and clients page until an answer comes
 * back empty — Yattee asks for up to fifty pages in a row. Ignoring the page
 * would be forty-nine more requests for the same three videos, so a page past
 * the end is an empty list and the client stops after one.
 */
export const PLAYLIST_PAGE = 100;

export function playlistPage(asked: string | undefined): number {
  const page = Math.trunc(Number(asked));
  return Number.isFinite(page) && page > 1 ? page : 1;
}

interface PlaylistRow {
  id: number;
  name: string;
}

async function videosIn(playlistId: number, page: number) {
  const rows = await database.prepare(
    `SELECT ${VIDEO_COLUMNS}
       FROM videos v
       JOIN channels c ON c.channel_id = v.channel_id
       JOIN user_playlist_videos pv ON pv.video_id = v.video_id AND pv.playlist_id = ?
      ORDER BY pv.position, pv.added_at, pv.video_id
      LIMIT ? OFFSET ?`
  ).all(playlistId, PLAYLIST_PAGE, (page - 1) * PLAYLIST_PAGE) as DetailRow[];
  // `index` is what a client dedupes overlapping pages by, so it counts from
  // the start of the playlist rather than from the start of this answer.
  return rows.map((row, offset) => {
    const index = (page - 1) * PLAYLIST_PAGE + offset;
    return { ...videoFromRow(row), index, indexId: String(index) };
  });
}

async function countIn(playlistId: number): Promise<number> {
  const row = await database
    .prepare("SELECT COUNT(*) AS count FROM user_playlist_videos WHERE playlist_id = ?")
    .get(playlistId) as { count: number } | null;
  return Number(row?.count ?? 0);
}

async function profileName(userId: number): Promise<string> {
  const row = await database.prepare("SELECT name FROM users WHERE id = ?").get(userId) as { name: string } | null;
  return row?.name ?? "";
}

async function documentFor(playlist: PlaylistRow, author: string, page: number) {
  return {
    type: "invidiousPlaylist",
    title: playlist.name,
    playlistId: localPlaylistId(playlist.id),
    // Whose playlist it is, which for a private one is whoever is asking.
    // The id is empty rather than absent: a client that reads one expects a
    // channel behind it, and this playlist has none.
    author,
    authorId: "",
    authorUrl: "",
    authorThumbnails: [] as unknown[],
    description: "",
    descriptionHtml: "",
    videoCount: await countIn(playlist.id),
    viewCount: 0,
    isListed: false,
    videos: await videosIn(playlist.id, page),
  };
}

/** Every playlist this profile owns, each with its first page of videos. */
export async function listLocalPlaylists(userId: number) {
  const playlists = await database.prepare(
    "SELECT id, name FROM user_playlists WHERE user_id = ? ORDER BY sort_order, id"
  ).all(userId) as PlaylistRow[];
  const author = await profileName(userId);
  return Promise.all(playlists.map((playlist) => documentFor(playlist, author, 1)));
}

/** One playlist, if this profile owns it. */
export async function localPlaylist(userId: number, playlistId: string, page: number) {
  const id = localPlaylistNumber(playlistId);
  if (id === null) return null;
  const playlist = await database
    .prepare("SELECT id, name FROM user_playlists WHERE id = ? AND user_id = ?")
    .get(id, userId) as PlaylistRow | null;
  if (!playlist) return null;
  return documentFor(playlist, await profileName(userId), page);
}
