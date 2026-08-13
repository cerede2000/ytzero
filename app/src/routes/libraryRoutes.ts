import type { Context, Hono } from "hono";
import { database } from "../database";
import { childLocalOnly, isChildUser } from "../childTime";
import { profileDownloadsEnabled } from "../downloadConfig";
import { cancelAutoDownloadIfUnwanted } from "../downloader";
import { refreshDiscoveryInBackground, searchQuerySuggestions } from "../plugins";
import { searchYouTube } from "../youtube";
import { feedSortSql, shortsUiVisibilitySql } from "../feedQuery";
import { buildCleanupWhere, countCleanupMatches, listCleanupVideoIds, snapshotUserVideoState, applyCleanupAction, restoreUserVideoState, saveBulkUndo, loadBulkUndo, clearBulkUndo, type CleanupFilter } from "../cleanup";
import { videoSelect, type VideoRow } from "../videoRoutesSupport";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;
type AttachWatchedState = typeof import("../videoRoutesSupport").attachWatchedState;

export function registerLibraryRoutes(
  api: Api,
  access: {
    currentUserId: (context: ApiContext) => number;
    attachTags: (userId: number, videos: VideoRow[]) => Promise<Array<VideoRow & Record<string, unknown>>>;
    attachWatchedState: AttachWatchedState;
  },
): void {
  const { currentUserId, attachTags, attachWatchedState } = access;

// ---------- feed cleanup ----------
// "clean" previews/counts what the filter would affect; "remain" previews what
// the feed would still look like afterwards. Both share buildCleanupWhere with
// GET /feed's own visibility rules, so what's shown here can never drift from
// what /cleanup/apply actually touches.
const CLEANUP_PAGE_SIZE = 24;

api.post("/cleanup/preview", async (c) => {
  const uid = currentUserId(c);
  const body = await c.req.json() as { filter?: CleanupFilter; exclude_video_ids?: string[]; side?: "clean" | "remain"; page?: number };
  const filter = body.filter ?? {};
  const excludeIds = body.exclude_video_ids ?? [];
  const side = body.side === "remain" ? "remain" : "clean";
  const page = Math.max(0, Number(body.page ?? 0));

  const { where, params } = buildCleanupWhere(filter, uid, side, excludeIds);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await database
    .prepare(`${videoSelect(uid)} ${whereSql} ORDER BY ${feedSortSql()} DESC LIMIT ? OFFSET ?`)
    .all(...params, CLEANUP_PAGE_SIZE, page * CLEANUP_PAGE_SIZE) as VideoRow[];
  const total = await countCleanupMatches(filter, uid, side, excludeIds);
  return c.json({ videos: await attachTags(uid, rows), total, page, limit: CLEANUP_PAGE_SIZE });
});

api.post("/cleanup/apply", async (c) => {
  const uid = currentUserId(c);
  const body = await c.req.json() as { filter?: CleanupFilter; exclude_video_ids?: string[]; action?: "archive" | "watched" };
  const filter = body.filter ?? {};
  const excludeIds = body.exclude_video_ids ?? [];
  if (body.action !== "archive" && body.action !== "watched") return c.json({ error: "invalid action" }, 400);

  const videoIds = await listCleanupVideoIds(filter, uid, excludeIds);
  if (videoIds.length === 0) return c.json({ affected: 0 });

  const snapshot = await snapshotUserVideoState(uid, videoIds);
  await applyCleanupAction(uid, videoIds, body.action);
  // Both outcomes end in status=archived, so a pending auto download nobody
  // will see anymore should stop the same way a single reject/watch does.
  for (const id of videoIds) await cancelAutoDownloadIfUnwanted(uid, id);
  await saveBulkUndo(uid, body.action, snapshot);
  refreshDiscoveryInBackground(uid);
  return c.json({ affected: videoIds.length });
});

api.post("/cleanup/undo", async (c) => {
  const uid = currentUserId(c);
  const entry = await loadBulkUndo(uid);
  if (!entry) return c.json({ error: "nothing to undo" }, 404);
  await restoreUserVideoState(uid, entry.snapshot);
  await clearBulkUndo(uid);
  refreshDiscoveryInBackground(uid);
  return c.json({ restored: entry.count });
});

api.get("/in-progress", async (c) => {
  const uid = currentUserId(c);
  const rows = await database.prepare(`
    ${videoSelect(uid)}
    JOIN (SELECT video_id, MAX(watched_at) AS last_watched FROM history WHERE user_id = ${uid} GROUP BY video_id) lw ON lw.video_id = v.video_id
    WHERE v.published_at IS NOT NULL AND v.published_at != ''
      AND uv.watch_position IS NOT NULL AND uv.watch_duration IS NOT NULL
      AND uv.watch_duration > 30
      AND uv.watch_position >= 3
      AND CAST(uv.watch_position AS REAL) / uv.watch_duration < 0.92
      AND COALESCE(uv.status, 'inbox') = 'inbox'
      AND ${shortsUiVisibilitySql(uid)}
    ORDER BY lw.last_watched DESC
    LIMIT 20
  `).all() as VideoRow[];
  return c.json({ videos: await attachTags(uid, rows) });
});

api.get("/search/youtube", async (c) => {
  const uid = currentUserId(c);
  // Restricted child profiles search only the local library.
  if (childLocalOnly(uid)) return c.json({ results: [] });
  const q = c.req.query("q");
  if (!q?.trim()) return c.json({ results: [] });
  try {
    const search = await searchYouTube(q.trim(), uid);
    const watched = await attachWatchedState(uid, search.results, (result) => result.videoId);
    const ids = watched.map((result) => result.videoId);
    const placeholders = ids.map(() => "?").join(",");
    const downloads = ids.length === 0 ? [] : await database.prepare(
      `SELECT owner.video_id, d.status
       FROM download_owners owner JOIN downloads d ON d.video_id = owner.video_id
       WHERE owner.user_id = ? AND owner.video_id IN (${placeholders})`,
    ).all(uid, ...ids) as { video_id: string; status: string }[];
    const downloadStatus = new Map(downloads.map((download) => [download.video_id, download.status]));
    const downloadsAllowed = !await isChildUser(uid);
    const downloadsEnabled = downloadsAllowed && await profileDownloadsEnabled(uid);
    return c.json({
      results: watched.map((result) => ({
        ...result,
        download_status: downloadStatus.get(result.videoId) ?? null,
        downloads_allowed: downloadsAllowed,
        downloads_enabled: downloadsEnabled,
      })),
      channels: search.channels,
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

// Type-ahead for the search box. The library answers for itself: followed
// channels are matched locally so the box can jump straight to a channel,
// without anything leaving the server.
//
// `suggestions` carries free-text query completions. Nothing in core produces
// them — that is a source a plugin supplies, the way TubeArchivist feeds the
// feed — so it stays empty until one is installed and enabled.
api.get("/search/suggest", async (c) => {
  const uid = currentUserId(c);
  const q = c.req.query("q")?.trim();
  if (!q) return c.json({ suggestions: [], channels: [] });

  const channels = await database.prepare(
    `SELECT ch.channel_id, COALESCE(ch.custom_title, ch.title) AS title, ch.thumbnail
       FROM channels ch
       JOIN user_channels uc ON uc.channel_id = ch.channel_id AND uc.user_id = ? AND uc.followed = 1
      WHERE ch.external = 0 AND COALESCE(ch.custom_title, ch.title) LIKE ?
      ORDER BY COALESCE(ch.custom_title, ch.title) COLLATE NOCASE
      LIMIT 4`
  ).all(uid, `%${q}%`);

  // Restricted child profiles never see anything but their own library.
  const language = c.req.query("hl")?.slice(0, 5) || "en";
  const suggestions = childLocalOnly(uid) ? [] : await searchQuerySuggestions(uid, q, language);
  return c.json({ suggestions, channels });
});

}
