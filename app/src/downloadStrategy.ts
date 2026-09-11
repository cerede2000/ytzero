import { preferDubbedAudio } from "./audioTrackLanguage";

/**
 * Prefer a separate video + audio pair, then fall back to a progressive
 * format. Keeping the height cap on every branch prevents a fallback from
 * silently exceeding the quality selected by the user.
 */
export function downloadFormat(quality: string, compatible = false, audioLanguage?: string): string {
  const parsedHeight = quality === "best" ? null : Number(quality);
  const height = parsedHeight != null && Number.isFinite(parsedHeight) && parsedHeight > 0
    ? Math.floor(parsedHeight)
    : null;
  if (compatible) {
    const compatibilityHeight = Math.min(height ?? 1080, 1080);
    const compatibilityCap = `[height<=${compatibilityHeight}]`;
    const dub = audioLanguage ? preferDubbedAudio(`bestvideo[vcodec^=avc1]${compatibilityCap}`, "bestaudio[acodec^=mp4a]", audioLanguage) : "";
    return `${dub}bestvideo[vcodec^=avc1]${compatibilityCap}+bestaudio[acodec^=mp4a]/best[ext=mp4][vcodec^=avc1][acodec^=mp4a]${compatibilityCap}`;
  }
  const cap = height ? `[height<=${height}]` : "";
  const dub = audioLanguage ? preferDubbedAudio(`bestvideo${cap}`, "bestaudio", audioLanguage) : "";
  return `${dub}bestvideo${cap}+bestaudio/bestvideo*${cap}/best${cap}`;
}

/**
 * Logged-in YouTube clients can expose fewer downloadable formats when a PO
 * Token is unavailable. Public videos therefore use the anonymous client
 * first; configured cookies remain a fallback for account-gated content.
 */
const COOKIE_PREFERENCE_TTL_MS = 15 * 60_000;
const cookieFirstUntil = new Map<number, number>();

/** yt-dlp's final line identifies an address refusal, unlike ordinary format,
 * network, or cookie failures. Never use a broad "failed" signal here. */
export function isAnonymousAddressRefusal(stderr: string): boolean {
  return /(?:LOGIN_REQUIRED[\s\S]*(?:sign in|confirm you(?:'|’)re not a bot)|(?:sign in|confirm you(?:'|’)re not a bot)[\s\S]*LOGIN_REQUIRED|confirm you(?:'|’)re not a bot)/i.test(stderr);
}

export function redactYtdlpDiagnostic(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, "<redacted-url>")
    .replace(/\/(?:Users|home)\/[^\s'"\]]+/g, "<local-path>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function downloadCookieAttempts(cookiesConfigured: boolean, userId = 0, now = Date.now()): boolean[] {
  if (!cookiesConfigured) return [false];
  return (cookieFirstUntil.get(userId) ?? 0) > now ? [true, false] : [false, true];
}

/** Record only completed attempts. Cookies become first only when they actually
 * rescued a recognised anonymous refusal for the same profile. */
export function recordDownloadAttempt(
  userId: number,
  useCookies: boolean,
  succeeded: boolean,
  anonymousRefused: boolean,
  now = Date.now(),
): void {
  if (!useCookies && succeeded) {
    cookieFirstUntil.delete(userId);
  } else if (useCookies && succeeded && anonymousRefused) {
    cookieFirstUntil.set(userId, now + COOKIE_PREFERENCE_TTL_MS);
  }
}

export function resetDownloadAttemptPreferences(): void { cookieFirstUntil.clear(); }

function sanitizePathComponent(segment: string): string {
  return segment
    .normalize("NFC")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[\\/:|]+/g, " - ")
    .replace(/[*?"<>]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "");
}

export function renderDownloadOutputTemplate(template: string, values: Record<string, string>, videoId: string): string {
  const rendered = (template.trim() || "{id}").replace(/\{(\w+)\}/g, (_, key: string) => sanitizePathComponent(values[key] ?? ""));
  const segments = rendered.split("/").map(sanitizePathComponent).filter(Boolean);
  let base = segments.join("/") || videoId;
  if (!base.includes(videoId)) base += ` [${videoId}]`;
  return base;
}
