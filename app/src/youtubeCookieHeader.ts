import { readFileSync } from "node:fs";
import { downloadCookiesConfigured, downloadCookiesFile } from "./downloadConfig";

/**
 * A profile's YouTube cookies, written the way a browser sends them.
 *
 * yt-dlp is handed the jar as a file, so nothing until now needed it as a
 * header. Reading the watch page does: it is a plain request, and a plain
 * request is what YouTube refuses when it does not know the caller.
 *
 * Only youtube.com cookies are taken out of the jar. An export made from a
 * browser carries whatever else was open at the time, and none of that belongs
 * in a request to YouTube.
 */
export function parseYoutubeCookieHeader(contents: string): string | null {
  const pairs: string[] = [];
  const seen = new Set<string>();
  for (const raw of contents.split("\n")) {
    // yt-dlp marks host-only cookies with a #HttpOnly_ prefix on an otherwise
    // ordinary line, so the prefix has to go before comments are skipped.
    const line = (raw.endsWith("\r") ? raw.slice(0, -1) : raw).replace(/^#HttpOnly_/, "");
    if (!line || line.startsWith("#")) continue;
    const fields = line.split("\t");
    if (fields.length < 7) continue;
    const domain = fields[0].replace(/^\./, "").toLowerCase();
    if (domain !== "youtube.com" && !domain.endsWith(".youtube.com")) continue;
    const name = fields[5];
    const value = fields[6];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    pairs.push(`${name}=${value}`);
  }
  return pairs.length > 0 ? pairs.join("; ") : null;
}

export function youtubeCookieHeader(userId: number): string | null {
  if (!Number.isInteger(userId) || userId <= 0 || !downloadCookiesConfigured(userId)) return null;
  try {
    return parseYoutubeCookieHeader(readFileSync(downloadCookiesFile(userId), "utf8"));
  } catch {
    return null;
  }
}
