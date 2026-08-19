import type { Context, Hono } from "hono";
import { isChildUser } from "../../childTime";
import { invidiousCompatEnabled } from "./enabled";
import { mintToken, revokeToken, tokenState } from "./tokens";

type ApiEnvironment = { Variables: { userId: number; sessionAdmin?: boolean; profileAdmin?: boolean } };
type Api = Hono<ApiEnvironment>;
type ApiContext = Context<ApiEnvironment>;

/**
 * Where a profile gets the token its phone will sign in with.
 *
 * These three live on the authenticated API rather than beside the dialect's
 * own routes: minting a credential is something the person already signed in
 * here does, for themselves. A client never reaches them.
 */
export function registerInvidiousAccessRoutes(api: Api, currentUserId: (context: ApiContext) => number): void {
  api.get("/invidious/token", async (c) => {
    const state = await tokenState(currentUserId(c));
    return c.json({
      enabled: invidiousCompatEnabled(),
      configured: state !== null,
      created_at: state?.createdAt ?? null,
      last_used_at: state?.lastUsedAt ?? null,
    });
  });

  /*
   * The only moment the token exists in readable form. What is stored is a
   * keyed hash, so this answer cannot be produced again — asking twice means
   * minting a second token, which revokes the first.
   */
  api.post("/invidious/token", async (c) => {
    /*
     * Not for a restricted profile. The dialect serves a library without any of
     * the limits this server puts on one — no local-only rule, no hidden live
     * streams, no watch-time ceiling — so a token minted here would be a way
     * around all of them, held by the person they apply to.
     */
    if (await isChildUser(currentUserId(c))) return c.json({ error: "not allowed" }, 403);
    return c.json({ token: await mintToken(currentUserId(c)) });
  });

  api.delete("/invidious/token", async (c) => {
    await revokeToken(currentUserId(c));
    return c.json({ ok: true });
  });
}
