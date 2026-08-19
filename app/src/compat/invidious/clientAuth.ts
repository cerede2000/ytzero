import { compatUserId } from "./context";
import { profileForNameAndToken, profileForToken, sidFrom } from "./tokens";

/**
 * Who is asking, on the routes where a client can say.
 *
 * The dialect has no session of its own outside `/api/v1/auth/*`, which is why
 * everything else was served for one named profile: there was nobody to ask.
 * But a client fronting an instance behind a reverse proxy sends HTTP Basic
 * credentials on every request — Yattee bakes the header into the client it
 * builds per instance — and that is an identity arriving on every route.
 *
 * So this server checks them itself, against the same pair the sign-in form
 * takes: the profile's name and a token minted for it. Two things follow at
 * once. The catalogue stops being open to whoever reaches the instance, which
 * is what it was, and it stops being one profile's for everybody, which is
 * what it had to be while nobody could be identified.
 *
 * Media links stay out of this. A player holds no credentials — Yattee's
 * attaches an Authorization header to WebDAV files and to nothing else — so
 * those routes keep proving themselves the only way they can, with the
 * signature they carry.
 */
export type CompatAuthMode = "open" | "basic";

export function compatAuthMode(): CompatAuthMode {
  return process.env.YTZERO_INVIDIOUS_COMPAT_AUTH === "basic" ? "basic" : "open";
}

export interface BasicCredentials {
  name: string;
  secret: string;
}

/** The two halves of an `Authorization: Basic` header, or nothing usable. */
export function basicCredentials(header: string | undefined | null): BasicCredentials | null {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec((header ?? "").trim());
  if (!match) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  // The password may contain colons; the name may not. That is the rule in
  // RFC 7617, and a token never carries one anyway.
  const colon = decoded.indexOf(":");
  if (colon <= 0) return null;
  return { name: decoded.slice(0, colon), secret: decoded.slice(colon + 1) };
}

/** Whose library the credentials on this request name, if they name one. */
async function profileFromBasic(header: string | undefined): Promise<number | null> {
  const credentials = basicCredentials(header);
  if (!credentials) return null;
  return profileForNameAndToken(credentials.name, credentials.secret);
}

/**
 * The profile a browsing request is for.
 *
 * Open, as before: the one profile the instance names. Requiring credentials:
 * whoever they belong to — which is what makes a household work, since the
 * feed a client calls trending is somebody's subscriptions, not a place.
 */
export async function browsingProfile(authorization: string | undefined): Promise<number | null> {
  if (compatAuthMode() === "open") return compatUserId();
  return profileFromBasic(authorization);
}

/**
 * The profile behind an account request: its session first, its credentials
 * after.
 *
 * The session stays first because it is what a client signs in to get, and it
 * works whether or not the instance asks for credentials. The fallback is what
 * lets a profile that only filled in the credential fields still reach its own
 * feed, without a second sign-in saying the same thing twice.
 */
export async function accountProfile(
  cookie: string | undefined,
  authorization: string | undefined,
): Promise<number | null> {
  const bySession = await profileForToken(sidFrom(cookie));
  if (bySession !== null) return bySession;
  return profileFromBasic(authorization);
}

/**
 * The refusal, shaped so a client knows what to ask its user for.
 *
 * Yattee concludes "this instance needs credentials" from the status alone and
 * offers the two fields; the header is what a browser and everything else
 * reads. Both cost one line.
 */
export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorised" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": 'Basic realm="YT Zero", charset="UTF-8"',
    },
  });
}
