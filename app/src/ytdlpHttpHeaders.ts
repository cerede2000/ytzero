export type YtdlpHttpHeaders = Record<string, string>;

/** Parse the request headers yt-dlp used when obtaining a signed media URL. */
export function parseYtdlpHttpHeaders(value: string): YtdlpHttpHeaders | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const entries = Object.entries(parsed);
  if (entries.some(([name, headerValue]) => !name || typeof headerValue !== "string")) return null;
  try {
    const headers = new Headers(entries as Array<[string, string]>);
    if (!headers.get("user-agent")) return null;
    return Object.fromEntries(headers.entries());
  } catch {
    return null;
  }
}

export function rangedYtdlpHeaders(httpHeaders: YtdlpHttpHeaders, range: string): Headers {
  const headers = new Headers(httpHeaders);
  headers.set("Range", range);
  return headers;
}
