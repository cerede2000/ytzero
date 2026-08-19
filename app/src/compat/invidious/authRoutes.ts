import type { Hono } from "hono";
import { database } from "../../database";
import { log } from "../../logger";
import { refreshChannel } from "../../refresher";
import { resolveChannelId } from "../../youtube";
import { accountProfile } from "./clientAuth";
import { listLocalPlaylists, localPlaylist, playlistPage } from "./playlists";
import { channelThumbnails, videoFromRow } from "./shapes";
import { profileForNameAndToken, profileForToken } from "./tokens";
import type { DetailRow } from "./videoDetail";

/**
 * The account half of the dialect: whose subscriptions, whose feed.
 *
 * These are the only routes a client sends its session to — it attaches the
 * cookie here and nowhere else — which is why the rest of the compatibility
 * layer serves one configured profile and this part serves whoever presented
 * the token.
 */
const VIDEO_COLUMNS = `
  v.video_id, v.title, v.description, v.thumbnail, v.published_at, v.live_status,
  v.views, v.likes, v.duration, v.channel_id,
  COALESCE(c.custom_title, c.title) AS channel_title
`;

type Request = { req: { header: (name: string) => string | undefined } };

/**
 * Whose account this request is about.
 *
 * The session the client was given, and failing that the credentials it sends
 * on every request anyway: a profile that only filled in the credential fields
 * of its app still reaches its own feed.
 */
async function profileFor(c: Request): Promise<number | null> {
  return accountProfile(c.req.header("cookie"), c.req.header("authorization"));
}

export function registerAuthRoutes(app: Hono): void {
  /**
   * The form post a client signs in with.
   *
   * Invidious answers a browser here, so the shape is a browser's: fields named
   * `email` and `password`, and a redirect carrying `Set-Cookie`. The client
   * blocks the redirect and reads the header, which is why the destination
   * hardly matters and the status must stay a 302.
   *
   * The password is a token minted for a profile, never an account password.
   * Both fields are checked: a token names its profile on its own, and
   * requiring the name to match as well means a token pasted against the wrong
   * profile is refused rather than quietly signing in as another.
   */
  app.post("/login", async (c) => {
    const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
    const userId = await profileForNameAndToken(String(form.email ?? ""), String(form.password ?? ""));
    if (userId === null) {
      log.info("invidious.login_refused", { reason: "no profile for that name and token" });
      return c.text("Wrong username or password", 401);
    }
    log.info("invidious.login", { userId });
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/",
        "Set-Cookie": `SID=${encodeURIComponent(String(form.password))}; Path=/; HttpOnly; SameSite=Lax`,
      },
    });
  });

  app.get("/api/v1/auth/feed", async (c) => {
    const userId = await profileFor(c);
    if (userId === null) return c.json({ error: "unauthorised" }, 401);
    const rows = await database.prepare(
      `SELECT ${VIDEO_COLUMNS}
         FROM videos v
         JOIN channels c ON c.channel_id = v.channel_id
         JOIN user_channels uc ON uc.channel_id = v.channel_id AND uc.user_id = ? AND uc.followed = 1
        WHERE v.published_at IS NOT NULL AND v.published_at != ''
          AND COALESCE(v.is_short, 0) = 0 AND COALESCE(v.is_unavailable, 0) = 0
        ORDER BY v.published_at DESC LIMIT ?`
    ).all(userId, feedSize(c.req.query("max_results"))) as DetailRow[];
    // `notifications` is what a client shows as new; the feed itself is the
    // list. Ours has no separate notion of unseen, so it stays empty rather
    // than repeating the videos under a second name.
    return c.json({ notifications: [], videos: rows.map(videoFromRow) });
  });

  app.get("/api/v1/auth/subscriptions", async (c) => {
    const userId = await profileFor(c);
    if (userId === null) return c.json({ error: "unauthorised" }, 401);
    const rows = await database.prepare(
      `SELECT ch.channel_id, COALESCE(ch.custom_title, ch.title) AS title, ch.thumbnail
         FROM channels ch
         JOIN user_channels uc ON uc.channel_id = ch.channel_id AND uc.user_id = ? AND uc.followed = 1
        ORDER BY COALESCE(ch.custom_title, ch.title) COLLATE NOCASE`
    ).all(userId) as { channel_id: string; title: string; thumbnail: string | null }[];
    return c.json(rows.map((row) => ({
      author: row.title,
      authorId: row.channel_id,
      authorUrl: `/channel/${row.channel_id}`,
      authorThumbnails: channelThumbnails(row.thumbnail),
    })));
  });

  /**
   * Following from the app, which is following in the library.
   *
   * A channel the library has never seen is resolved and inserted the way the
   * web interface does it, so the two ways of subscribing leave the same rows
   * behind and the first refresh happens without being asked for.
   */
  app.post("/api/v1/auth/subscriptions/:id", async (c) => {
    const userId = await profileFor(c);
    if (userId === null) return c.json({ error: "unauthorised" }, 401);
    const channelId = c.req.param("id");
    const known = await database.prepare("SELECT 1 FROM channels WHERE channel_id = ?").get(channelId);
    if (!known) {
      try {
        const info = await resolveChannelId(`https://www.youtube.com/channel/${channelId}`);
        await database.prepare(
          "INSERT OR IGNORE INTO channels (channel_id, title, url, thumbnail) VALUES (?, ?, ?, ?)"
        ).run(info.channelId, info.title, `https://www.youtube.com/channel/${info.channelId}`, info.thumbnail);
      } catch (error) {
        log.warn("invidious.subscribe_failed", { channelId, error: error instanceof Error ? error.message : String(error) });
        return c.json({ error: "unknown channel" }, 404);
      }
    }
    await database.prepare(
      `INSERT INTO user_channels (user_id, channel_id, followed) VALUES (?, ?, 1)
       ON CONFLICT(user_id, channel_id) DO UPDATE SET followed = 1`
    ).run(userId, channelId);
    await database.prepare("UPDATE channels SET external = 0 WHERE channel_id = ?").run(channelId);
    log.info("invidious.subscribed", { userId, channelId });
    if (!known) {
      refreshChannel(channelId).catch((error) =>
        log.warn("invidious.subscribe_refresh_failed", { channelId, error: error instanceof Error ? error.message : String(error) }));
    }
    return c.body(null, 204);
  });

  app.delete("/api/v1/auth/subscriptions/:id", async (c) => {
    const userId = await profileFor(c);
    if (userId === null) return c.json({ error: "unauthorised" }, 401);
    // Unfollowed, not forgotten: the channel and its videos stay, exactly as
    // unsubscribing in the web interface leaves them.
    await database
      .prepare("UPDATE user_channels SET followed = 0 WHERE user_id = ? AND channel_id = ?")
      .run(userId, c.req.param("id"));
    log.info("invidious.unsubscribed", { userId, channelId: c.req.param("id") });
    return c.body(null, 204);
  });

  app.get("/api/v1/auth/playlists", async (c) => {
    const userId = await profileFor(c);
    if (userId === null) return c.json({ error: "unauthorised" }, 401);
    return c.json(await listLocalPlaylists(userId));
  });

  /**
   * One playlist, which is where the videos a client shows actually come from.
   *
   * The list above carries videos as well, and a client displays none of them:
   * opening a playlist refetches that one playlist, and the answer replaces
   * what the list said. Without this route the refetch lands on the public
   * one, which looks for a channel's playlist under an account's id, finds
   * nothing, and the playlist opens empty.
   */
  app.get("/api/v1/auth/playlists/:id", async (c) => {
    const userId = await profileFor(c);
    if (userId === null) return c.json({ error: "unauthorised" }, 401);
    const playlist = await localPlaylist(userId, c.req.param("id"), playlistPage(c.req.query("page")));
    return playlist ? c.json(playlist) : c.json({ error: "not found" }, 404);
  });
}

/** What a client asked for, kept to something a feed can answer with. */
export function feedSize(asked: string | undefined): number {
  const wanted = Math.trunc(Number(asked));
  if (!Number.isFinite(wanted) || wanted <= 0) return 60;
  return Math.min(wanted, 200);
}
