import type { Hono } from "hono";
export { invidiousCompatEnabled } from "./enabled";
import { log } from "../../logger";
import { registerAuthRoutes } from "./authRoutes";
import { invidiousCompatEnabled } from "./enabled";
import { registerCatalogRoutes } from "./catalogRoutes";
import { registerDailymotionMediaRoutes } from "./dailymotion";
import { registerMediaRoutes } from "./mediaRoutes";

/**
 * Speaking Invidious, so that clients written for it can use this server.
 *
 * Yattee, Clipious and FreeTube all talk to a handful of `/api/v1/...` paths
 * that Invidious defined. Answering them is what lets a phone app point at
 * this instance instead of a public one — the library, the subscriptions and
 * the downloads are already here, only the dialect was missing.
 *
 * Everything for it lives in this folder, and the whole feature is one call in
 * `index.ts`. Nothing under `src/routes/` imports it, and it registers on the
 * outer app rather than on the `/api` router, so it stays out of both the
 * session middleware and the route manifest that speaks for upstream's own
 * routes. Deleting the folder and that one line removes it completely.
 *
 * Off unless asked for. This is a second front door on a server that is often
 * exposed, and a door nobody opened should not exist.
 */
export function registerInvidiousCompat(app: Hono): void {
  if (!invidiousCompatEnabled()) return;

  /*
   * None of these carry authentication of their own, because the clients do
   * not offer any: Yattee attaches its session cookie to `/api/v1/auth/*` and
   * to nothing else. What keeps a private instance private is the layer in
   * front of it — an instance behind HTTP Basic Auth still challenges every
   * one of these, which Yattee supports and answers on each request — and the
   * media links, which carry their own signature because a player follows them
   * with no session at all.
   */
  registerCatalogRoutes(app);
  registerMediaRoutes(app);
  registerDailymotionMediaRoutes(app);
  /*
   * The one part a client does authenticate: it attaches its session to
   * `/api/v1/auth/*` and to nothing else. So these routes serve whoever
   * presented the token, while everything above serves the configured profile.
   */
  registerAuthRoutes(app);

  log.info("invidious.compat_enabled", {});
}
