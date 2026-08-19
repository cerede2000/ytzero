import type { Hono } from "hono";
import { requestOrigin } from "../../auth";
import { database } from "../../database";
import { log } from "../../logger";
import { SEARCH_PROVIDERS } from "../../searchProviderCatalog";
import { searchAcrossProviders } from "../../searchProviders";
import { ensureVideoImported } from "../../videoImport";
import { fetchSearchSuggestions } from "../../youtube";
import { fetchVideoComments } from "../../youtubeComments";
import { compatUserId } from "./context";
import { invidiousStats } from "./stats";
import {
  channelFromRow,
  channelFromSearchResult,
  commentsFrom,
  videoFromRow,
  videoFromSearchResult,
  type ChannelRowLike,
} from "./shapes";
import { videoDetail, warmMedia, type DetailRow } from "./videoDetail";

/**
 * The catalogue an Invidious client browses.
 *
 * Every list here is answered from this library rather than from YouTube: a
 * channel's videos are the ones this server has collected, and the home lists
 * are this profile's subscriptions. That is the point of pointing a phone at
 * your own instance, and it is also why a channel nobody follows answers 404
 * instead of quietly importing itself because a stranger's client asked.
 */
const VIDEO_COLUMNS = `
  v.video_id, v.title, v.description, v.thumbnail, v.published_at, v.live_status,
  v.views, v.likes, v.duration, v.channel_id,
  COALESCE(c.custom_title, c.title) AS channel_title,
  c.thumbnail AS channel_thumbnail, c.subscriber_count AS channel_subscriber_count
`;
const FROM_VIDEOS = "FROM videos v JOIN channels c ON c.channel_id = v.channel_id";

/** Pages are the continuation: opaque to the client, a number to us. */
const PAGE_SIZE = 30;
function pageFrom(value: string | undefined): number {
  const page = Math.trunc(Number(value));
  return Number.isFinite(page) && page > 1 ? page : 1;
}

export function registerCatalogRoutes(app: Hono): void {
  app.get("/api/v1/stats", (c) => c.json(invidiousStats()));

  /*
   * Yattee probes for PeerTube before it probes for us, on a path that would
   * otherwise reach the session-guarded API and be refused. A 401 there is
   * read as "this instance wants HTTP Basic credentials" — so the probe is
   * answered plainly instead: there is no PeerTube here.
   */
  app.get("/api/v1/config", (c) => c.json({ error: "not found" }, 404));

  app.get("/api/v1/search", async (c) => {
    const query = c.req.query("q")?.trim();
    if (!query) return c.json([]);
    const type = c.req.query("type") ?? "all";
    if (type === "playlist") return c.json([]);
    const youtube = SEARCH_PROVIDERS.filter((provider) => provider.id === "youtube");
    const { found } = await searchAcrossProviders(query, youtube, pageFrom(c.req.query("page")), await compatUserId());
    const search = found.youtube;
    const items: unknown[] = [];
    if (type !== "video") items.push(...(search?.channels ?? []).map(channelFromSearchResult));
    if (type !== "channel") items.push(...(search?.results ?? []).map((result) => videoFromSearchResult(result)));
    return c.json(items);
  });

  app.get("/api/v1/search/suggestions", async (c) => {
    const query = c.req.query("q")?.trim();
    if (!query) return c.json({ query: "", suggestions: [] });
    try {
      return c.json({ query, suggestions: await fetchSearchSuggestions(query) });
    } catch (error) {
      log.warn("invidious.suggestions_failed", { error: error instanceof Error ? error.message : String(error) });
      return c.json({ query, suggestions: [] });
    }
  });

  app.get("/api/v1/videos/:id", async (c) => {
    const videoId = c.req.param("id");
    const userId = await compatUserId();
    /*
     * The file first, before anything is known about the video.
     *
     * Fetching it needs the id and nothing else, while the two steps below
     * cost five seconds each — importing a video the library has never seen,
     * and resolving its subtitles. Started after them, the player waits for
     * all three in turn; started here, it waits for the longest of them.
     */
    warmMedia(userId, videoId);
    // A video reached from search is not in the library yet. Importing it is
    // what the web interface does when the same video is opened there, so
    // history and progress land in the same place whichever one played it.
    await ensureVideoImported(userId, videoId);
    const row = await database
      .prepare(`SELECT ${VIDEO_COLUMNS} ${FROM_VIDEOS} WHERE v.video_id = ?`)
      .get(videoId) as DetailRow | null;
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json(await videoDetail(userId, row, requestOrigin(c)));
  });

  app.get("/api/v1/comments/:id", async (c) => {
    try {
      const comments = await fetchVideoComments(await compatUserId(), c.req.param("id"));
      return c.json({ ...commentsFrom(comments.comments), videoId: c.req.param("id") });
    } catch (error) {
      log.warn("invidious.comments_failed", { videoId: c.req.param("id"), error: error instanceof Error ? error.message : String(error) });
      return c.json({ commentCount: 0, videoId: c.req.param("id"), comments: [] });
    }
  });

  app.get("/api/v1/channels/:id", async (c) => {
    const row = await database
      .prepare("SELECT * FROM channels WHERE channel_id = ?")
      .get(c.req.param("id")) as (ChannelRowLike & Record<string, unknown>) | null;
    if (!row) return c.json({ error: "not found" }, 404);
    const latest = await channelVideos(c.req.param("id"), 1, "videos");
    return c.json({ ...channelFromRow(row), latestVideos: latest });
  });

  const tab = (kind: "videos" | "shorts" | "streams") => async (c: { req: { param: (k: string) => string; query: (k: string) => string | undefined } }) => {
    const page = pageFrom(c.req.query("continuation"));
    const videos = await channelVideos(c.req.param("id"), page, kind);
    return { videos, continuation: videos.length < PAGE_SIZE ? null : String(page + 1) };
  };
  app.get("/api/v1/channels/:id/videos", async (c) => c.json(await tab("videos")(c)));
  app.get("/api/v1/channels/:id/shorts", async (c) => c.json(await tab("shorts")(c)));
  app.get("/api/v1/channels/:id/streams", async (c) => c.json(await tab("streams")(c)));

  app.get("/api/v1/channels/:id/playlists", async (c) => {
    const rows = await database.prepare(
      "SELECT playlist_id, title, thumbnail, video_count FROM channel_playlists WHERE channel_id = ? ORDER BY updated_at DESC"
    ).all(c.req.param("id")) as { playlist_id: string; title: string; thumbnail: string; video_count: string }[];
    const channel = await database.prepare("SELECT COALESCE(custom_title, title) AS title FROM channels WHERE channel_id = ?")
      .get(c.req.param("id")) as { title: string } | null;
    return c.json({
      playlists: rows.map((row) => ({
        type: "playlist",
        playlistId: row.playlist_id,
        title: row.title,
        author: channel?.title ?? "",
        authorId: c.req.param("id"),
        videoCount: Math.trunc(Number(row.video_count)) || 0,
        playlistThumbnail: row.thumbnail,
      })),
      continuation: null,
    });
  });

  app.get("/api/v1/playlists/:id", async (c) => {
    const playlistId = c.req.param("id");
    const playlist = await database.prepare(
      `SELECT p.playlist_id, p.title, p.thumbnail, p.channel_id, COALESCE(c.custom_title, c.title) AS author
         FROM channel_playlists p JOIN channels c ON c.channel_id = p.channel_id
        WHERE p.playlist_id = ?`
    ).get(playlistId) as { playlist_id: string; title: string; thumbnail: string; channel_id: string; author: string } | null;
    if (!playlist) return c.json({ error: "not found" }, 404);
    const rows = await database.prepare(
      `SELECT ${VIDEO_COLUMNS} ${FROM_VIDEOS}
         JOIN channel_playlist_videos pv ON pv.video_id = v.video_id AND pv.playlist_id = ?
        ORDER BY pv.position, pv.discovered_at DESC`
    ).all(playlistId) as DetailRow[];
    const videos = rows.map((row, index) => ({ ...videoFromRow(row), index }));
    return c.json({
      type: "playlist",
      playlistId: playlist.playlist_id,
      title: playlist.title,
      author: playlist.author,
      authorId: playlist.channel_id,
      description: "",
      videoCount: videos.length,
      viewCount: 0,
      videos,
    });
  });

  /*
   * A client's home asks for what is trending and what is popular. Nothing
   * here scrapes either, and answering with YouTube's idea of them would be a
   * different server's answer — so both say what this instance is actually
   * for: the newest videos from the channels this profile follows.
   */
  const home = async () => {
    const rows = await database.prepare(
      `SELECT ${VIDEO_COLUMNS} ${FROM_VIDEOS}
         JOIN user_channels uc ON uc.channel_id = v.channel_id AND uc.user_id = ? AND uc.followed = 1
        WHERE v.published_at IS NOT NULL AND v.published_at != ''
          AND COALESCE(v.is_short, 0) = 0 AND COALESCE(v.is_unavailable, 0) = 0
        ORDER BY v.published_at DESC LIMIT 60`
    ).all(await compatUserId()) as DetailRow[];
    return rows.map(videoFromRow);
  };
  app.get("/api/v1/trending", async (c) => c.json(await home()));
  app.get("/api/v1/popular", async (c) => c.json(await home()));
}

async function channelVideos(channelId: string, page: number, kind: "videos" | "shorts" | "streams") {
  const filter = kind === "shorts" ? "AND v.is_short = 1"
    : kind === "streams" ? "AND v.live_status IN ('live', 'was_live')"
    : "AND COALESCE(v.is_short, 0) = 0";
  const rows = await database.prepare(
    `SELECT ${VIDEO_COLUMNS} ${FROM_VIDEOS}
      WHERE v.channel_id = ? ${filter} AND COALESCE(v.is_unavailable, 0) = 0
      ORDER BY v.published_at DESC LIMIT ? OFFSET ?`
  ).all(channelId, PAGE_SIZE, (page - 1) * PAGE_SIZE) as DetailRow[];
  return rows.map(videoFromRow);
}
