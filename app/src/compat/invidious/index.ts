import type { Hono } from "hono";
export { invidiousCompatEnabled } from "./enabled";
import { log } from "../../logger";
import { compatAuthMode } from "./clientAuth";
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
   * What keeps a private instance private, in two halves.
   *
   * The catalogue can ask for HTTP Basic credentials itself — see `clientAuth`
   * — because a client sends them on every request, which is the one identity
   * this dialect carries outside `/api/v1/auth/*`. Set
   * `YTZERO_INVIDIOUS_COMPAT_AUTH=basic` and the browsing is both closed and
   * per-profile; left open it serves the configured profile to whoever asks,
   * which is why the instance had better have something in front of it.
   *
   * The media links are the other half, and they are not part of that choice:
   * a player follows them holding nothing at all, so they carry a signature
   * naming the video and the hour it expires.
   */
  registerCatalogRoutes(app);
  registerMediaRoutes(app);
  registerDailymotionMediaRoutes(app);
  /*
   * The part a client signs in to: it attaches its session to `/api/v1/auth/*`
   * and to nothing else. These routes serve whoever presented that session,
   * or, failing one, whoever the credentials on the request belong to.
   */
  registerAuthRoutes(app);

  log.info("invidious.compat_enabled", { auth: compatAuthMode() });
}
