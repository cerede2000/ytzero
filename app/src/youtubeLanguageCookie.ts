import { acceptLanguage, type PanelLanguage } from "./relatedVideoText";

/**
 * The language preference YouTube keeps in its own cookie.
 *
 * `PREF` is where the site stores what someone chose in its interface, and it
 * outranks everything else: measured on one search, a jar carrying `hl=en`
 * answered "Looking back: The Facel Vega saga!" while `Accept-Language:
 * fr-FR` asked for French, and the same jar with `hl=fr` answered "Dans le
 * rétro : La saga Facel Vega !" while the header asked for English.
 *
 * A jar exported from a browser signed in to YouTube carries whatever that
 * browser was set to, so an instance asking in French on behalf of a reader
 * whose jar says English was being answered in English — the header and the
 * `hl` in the request body never had a say.
 *
 * Rewriting that one preference is the whole fix. Nothing else in the jar is
 * touched: the session, its authorisation and everything YouTube uses to know
 * who is asking travel exactly as they were given.
 */
export function withLanguagePreference(cookieHeader: string | null, language: PanelLanguage): string {
  const wanted = `hl=${language}`;
  const cookies = (cookieHeader ?? "").split(";").map((part) => part.trim()).filter(Boolean);
  const index = cookies.findIndex((cookie) => cookie.startsWith("PREF="));
  if (index < 0) {
    cookies.push(`PREF=${wanted}`);
    return cookies.join("; ");
  }
  const preferences = cookies[index].slice("PREF=".length).split("&").filter(Boolean);
  const at = preferences.findIndex((preference) => preference === "hl" || preference.startsWith("hl="));
  if (at < 0) preferences.push(wanted); else preferences[at] = wanted;
  cookies[index] = `PREF=${preferences.join("&")}`;
  return cookies.join("; ");
}

/** The two ways a request states its language, kept in step with each other. */
export function languageHeaders(cookieHeader: string | null, language: PanelLanguage): { "Accept-Language": string; Cookie: string } {
  return { "Accept-Language": acceptLanguage(language), Cookie: withLanguagePreference(cookieHeader, language) };
}
