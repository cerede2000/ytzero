/**
 * Keeping a cookie jar current, the way a browser does.
 *
 * YouTube rotates cookies: it hands back new values in `Set-Cookie` as you
 * browse, and expects the next request to carry them. A browser writes them
 * down; a file exported once does not, so the copy on disk drifts behind what
 * YouTube expects until it is no longer recognised at all — the account is
 * fine, the export is stale, and every signed-in request quietly becomes an
 * anonymous one.
 *
 * yt-dlp already does its half: `--cookies FILE` reads from the file *and
 * dumps the jar back into it*, so every download and every lookup refreshes
 * what is on disk. Plain requests made here did not, which left the jar being
 * kept current by one half of the traffic and aged by the other.
 */

interface JarLine {
  domain: string;
  includeSubdomains: string;
  path: string;
  secure: string;
  expires: string;
  name: string;
  value: string;
  /** yt-dlp marks host-only cookies with a prefix on an otherwise normal line. */
  httpOnly: boolean;
}

const HTTP_ONLY = "#HttpOnly_";

function parseJar(contents: string): { header: string[]; lines: JarLine[] } {
  const header: string[] = [];
  const lines: JarLine[] = [];
  for (const raw of contents.split("\n")) {
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const httpOnly = text.startsWith(HTTP_ONLY);
    const body = httpOnly ? text.slice(HTTP_ONLY.length) : text;
    const fields = body.split("\t");
    if (!httpOnly && (body.startsWith("#") || body.trim() === "")) {
      if (lines.length === 0 && body.trim() !== "") header.push(text);
      continue;
    }
    if (fields.length < 7) continue;
    lines.push({
      domain: fields[0], includeSubdomains: fields[1], path: fields[2],
      secure: fields[3], expires: fields[4], name: fields[5], value: fields.slice(6).join("\t"),
      httpOnly,
    });
  }
  return { header: header.length > 0 ? header : ["# Netscape HTTP Cookie File"], lines };
}

function render(jar: { header: string[]; lines: JarLine[] }): string {
  const rows = jar.lines.map((line) =>
    `${line.httpOnly ? HTTP_ONLY : ""}${line.domain}\t${line.includeSubdomains}\t${line.path}\t${line.secure}\t${line.expires}\t${line.name}\t${line.value}`);
  return [...jar.header, ...rows, ""].join("\n");
}

interface Update {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  secure: boolean;
  httpOnly: boolean;
  /** The server is withdrawing this cookie rather than replacing it. */
  removed: boolean;
}

function parseSetCookie(header: string, now: number): Update | null {
  const [pair, ...attributes] = header.split(";");
  const eq = pair.indexOf("=");
  if (eq <= 0) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (!name) return null;
  const update: Update = {
    name, value, domain: "", path: "/", expires: 0, secure: false, httpOnly: false, removed: false,
  };
  for (const attribute of attributes) {
    const at = attribute.indexOf("=");
    const key = (at < 0 ? attribute : attribute.slice(0, at)).trim().toLowerCase();
    const raw = at < 0 ? "" : attribute.slice(at + 1).trim();
    if (key === "domain") update.domain = raw.replace(/^\./, "");
    else if (key === "path" && raw) update.path = raw;
    else if (key === "secure") update.secure = true;
    else if (key === "httponly") update.httpOnly = true;
    else if (key === "max-age") {
      const seconds = Number(raw);
      if (Number.isFinite(seconds)) update.expires = Math.floor(now / 1000) + seconds;
      if (Number.isFinite(seconds) && seconds <= 0) update.removed = true;
    } else if (key === "expires" && update.expires === 0) {
      const at = Date.parse(raw);
      if (Number.isFinite(at)) {
        update.expires = Math.floor(at / 1000);
        if (at <= now) update.removed = true;
      }
    }
  }
  // A cookie cleared by value rather than by date is still a withdrawal.
  if (value === "" ) update.removed = true;
  return update;
}

/** Whether a name belongs to YouTube, so nothing else is ever written down. */
function isYoutube(domain: string): boolean {
  const bare = domain.replace(/^\./, "").toLowerCase();
  return bare === "youtube.com" || bare.endsWith(".youtube.com");
}

/**
 * The jar as it stands after a response, given what that response set.
 *
 * Cookies for anywhere but YouTube are ignored: this jar exists to talk to
 * YouTube, and a redirect through another host has no business adding to it.
 * Returns null when nothing changed, so a jar is never rewritten for nothing.
 */
export function mergeSetCookies(contents: string, headers: readonly string[], now = Date.now()): string | null {
  if (headers.length === 0) return null;
  const jar = parseJar(contents);
  let changed = false;
  for (const header of headers) {
    const update = parseSetCookie(header, now);
    if (!update) continue;
    const domain = update.domain || jar.lines.find((line) => line.name === update.name)?.domain?.replace(/^\./, "") || "";
    if (!domain || !isYoutube(domain)) continue;
    const index = jar.lines.findIndex((line) =>
      line.name === update.name && line.domain.replace(/^\./, "") === domain && line.path === update.path);
    if (update.removed) {
      if (index >= 0) { jar.lines.splice(index, 1); changed = true; }
      continue;
    }
    const line: JarLine = {
      domain: index >= 0 ? jar.lines[index].domain : `.${domain}`,
      includeSubdomains: "TRUE",
      path: update.path,
      secure: update.secure ? "TRUE" : "FALSE",
      expires: String(update.expires || (index >= 0 ? jar.lines[index].expires : 0)),
      name: update.name,
      value: update.value,
      httpOnly: update.httpOnly || (index >= 0 ? jar.lines[index].httpOnly : false),
    };
    if (index >= 0) {
      const before = jar.lines[index];
      if (before.value === line.value && before.expires === line.expires) continue;
      jar.lines[index] = line;
    } else {
      jar.lines.push(line);
    }
    changed = true;
  }
  return changed ? render(jar) : null;
}
