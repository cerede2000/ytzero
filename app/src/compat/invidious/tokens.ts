import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { database } from "../../database";
import { log } from "../../logger";
import { mediaSecret } from "./media";

/**
 * How a client proves whose library it is asking about.
 *
 * The dialect authenticates the way Invidious does: a form post of an email
 * and a password, answered with a session cookie the client sends back. Here
 * the email is the profile's name and the password is a token generated for
 * it — nobody's real password crosses the wire, and a token can be revoked
 * without touching the account it belongs to.
 *
 * The token is also the cookie. Invidious's `SID` is a bearer credential
 * already, so minting a second one to stand for the first would be a second
 * thing to expire, revoke and store for no gain: regenerating the token turns
 * away every device holding the old one, at once.
 *
 * What is stored is a keyed hash. The key is the one that signs media links,
 * so a stolen database yields neither playable links nor usable tokens, and
 * the hash is deterministic — which is what lets a presented token find its
 * profile without trying every profile in turn.
 */
const PREFIX = "ytz_";

export function looksLikeToken(value: string | undefined | null): boolean {
  return typeof value === "string" && /^ytz_[0-9a-f]{64}$/.test(value);
}

async function hashOf(token: string): Promise<string> {
  return createHmac("sha256", await mediaSecret()).update(token).digest("hex");
}

/** A new token for this profile, replacing whatever it had. Shown once. */
export async function mintToken(userId: number): Promise<string> {
  const token = PREFIX + randomBytes(32).toString("hex");
  const hash = await hashOf(token);
  await database.prepare("DELETE FROM invidious_tokens WHERE user_id = ?").run(userId);
  await database
    .prepare("INSERT INTO invidious_tokens (user_id, token_hash) VALUES (?, ?)")
    .run(userId, hash);
  log.info("invidious.token_minted", { userId });
  return token;
}

export async function revokeToken(userId: number): Promise<void> {
  await database.prepare("DELETE FROM invidious_tokens WHERE user_id = ?").run(userId);
  log.info("invidious.token_revoked", { userId });
}

export interface TokenState {
  createdAt: string;
  lastUsedAt: string | null;
}

/** What the settings screen can say about a profile's token, never the token. */
export async function tokenState(userId: number): Promise<TokenState | null> {
  const row = await database
    .prepare("SELECT created_at, last_used_at FROM invidious_tokens WHERE user_id = ?")
    .get(userId) as { created_at: string; last_used_at: string | null } | null;
  return row ? { createdAt: row.created_at, lastUsedAt: row.last_used_at } : null;
}

/**
 * Whose token this is, or nothing.
 *
 * The comparison is constant-time even though the lookup is by hash: the row
 * is found by the hash of what was presented, and the stored hash is then
 * checked against it, so a partial match cannot be walked towards a whole one.
 */
export async function profileForToken(token: string | undefined | null): Promise<number | null> {
  if (!looksLikeToken(token)) return null;
  const hash = await hashOf(token!);
  const row = await database
    .prepare("SELECT user_id, token_hash FROM invidious_tokens WHERE token_hash = ?")
    .get(hash) as { user_id: number; token_hash: string } | null;
  if (!row) return null;
  const presented = Buffer.from(hash, "hex");
  const stored = Buffer.from(row.token_hash, "hex");
  if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) return null;
  await database
    .prepare("UPDATE invidious_tokens SET last_used_at = ? WHERE user_id = ?")
    .run(new Date().toISOString().slice(0, 19).replace("T", " "), row.user_id);
  return row.user_id;
}

/**
 * A profile named and proved in one go.
 *
 * Both halves are checked. A token finds its own profile, so the name adds
 * nothing to the lookup — but it means a token pasted against the wrong
 * profile is refused instead of quietly opening the library it does belong to,
 * which is the mistake somebody sharing an instance would actually make.
 */
export async function profileForNameAndToken(name: string, token: string): Promise<number | null> {
  const userId = await profileForToken(token);
  if (userId === null) return null;
  const profile = await database.prepare("SELECT name FROM users WHERE id = ?").get(userId) as { name: string } | null;
  if (!profile || profile.name.toLowerCase() !== name.trim().toLowerCase()) return null;
  return userId;
}

/** The `SID` a client sends back on every account request. */
export function sidFrom(cookieHeader: string | undefined): string | null {
  const match = cookieHeader?.match(/(?:^|;\s*)SID=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
