import type { YtdlpHttpHeaders } from "./ytdlpHttpHeaders";

/**
 * The one header worth carrying from a resolved format: who is asking.
 *
 * yt-dlp prints the headers it used to fetch the *watch page* — an HTML accept
 * list and `Sec-Fetch-Mode: navigate` among them. Sent on a byte range they
 * describe something that is not happening, and measured against a freshly
 * resolved URL they are the difference between 403 and 206: the same URL, the
 * same range, answered in forty milliseconds with the user agent alone.
 *
 * So the parsed headers are narrowed before anything fetches with them. A URL
 * minted for a signed-in client still needs to be asked for by something that
 * looks like that client, which is what the user agent says.
 */
export function askingHeadersOnly(headers: YtdlpHttpHeaders | null): YtdlpHttpHeaders | null {
  if (!headers) return null;
  const userAgent = headers["user-agent"] ?? headers["User-Agent"];
  return typeof userAgent === "string" && userAgent ? { "User-Agent": userAgent } : null;
}
