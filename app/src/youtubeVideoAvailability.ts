export class PrivateVideoError extends Error {
  readonly code = "PRIVATE_VIDEO";

  constructor(message = "Private video") {
    super(message);
    this.name = "PrivateVideoError";
  }
}

export class DeletedVideoError extends Error {
  readonly code = "DELETED_VIDEO";

  constructor(message = "Video unavailable") {
    super(message);
    this.name = "DeletedVideoError";
  }
}

export function isPrivateVideoError(error: unknown): boolean {
  return error instanceof PrivateVideoError
    || (error instanceof Error && /\bprivate video\b/i.test(error.message));
}

/**
 * "This video is gone", in the languages the pages are asked for.
 *
 * The watch page answers in whatever language the request asked for, and the
 * requests follow the library's language now — so an English-only test stopped
 * recognising a deleted video the day that changed, and the row was never
 * marked. Measured on the same deleted video, one request per language:
 *
 *     en  Video unavailable
 *     fr  Vidéo non disponible
 *     de  Video nicht verfügbar
 *     pl  Film niedostępny
 *
 * yt-dlp's own wording is not localised, so the English phrasings below still
 * carry the paths that read its stderr rather than a page.
 */
const DELETED_WORDINGS = [
  /\b(?:video unavailable|video (?:has been|was) removed|removed by (?:the )?uploader)\b/i,
  /vid(?:é|e)o non disponible/i,
  /video nicht verf(?:ü|u)gbar/i,
  /film niedost(?:ę|e)pny/i,
];

export function isDeletedVideoError(error: unknown): boolean {
  if (error instanceof DeletedVideoError) return true;
  return error instanceof Error && DELETED_WORDINGS.some((wording) => wording.test(error.message));
}

export type VideoOEmbedAvailability = "available" | "unavailable" | "unknown";

export function videoOEmbedAvailabilityFromStatus(status: number): VideoOEmbedAvailability {
  if (status >= 200 && status < 300) return "available";
  if (status === 401 || status === 403 || status === 404) return "unavailable";
  return "unknown";
}

export async function fetchVideoOEmbedAvailability(
  videoId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VideoOEmbedAvailability> {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const response = await fetchImpl(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
    { headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9" } },
  );
  if (response.status === 429) throw new Error("YouTube oEmbed availability failed (429)");
  await response.body?.cancel().catch(() => {});
  return videoOEmbedAvailabilityFromStatus(response.status);
}
