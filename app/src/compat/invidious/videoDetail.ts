import { existsSync } from "node:fs";
import { getDownload, listSubtitleFiles } from "../../downloader";
import { knownSubtitleTracks, subtitleLanguages, subtitleTracks } from "../../subtitleTracks";
import { log } from "../../logger";
import { ADAPTIVE_HEIGHTS, BEST_HEIGHT, OFFERED_HEIGHTS, cachedEntry, cachedMedia, startFetch } from "./mediaCache";
import { directGrace, directResponse } from "./mediaRoutes";
import { signedCaptionPath, signedMediaUrl } from "./media";
import { channelThumbnails, labelledQualities, videoFromRow, type VideoRowLike } from "./shapes";

export interface DetailRow extends VideoRowLike {
  channel_thumbnail?: string | null;
  channel_subscriber_count?: string | null;
}

/**
 * How long a video's document may wait on subtitles nobody has resolved yet.
 *
 * The resolution is a yt-dlp run of five to seven seconds with no timeout of
 * its own, and until it returns the player has not been told where the video
 * is — so it is not five seconds of subtitles, it is five seconds of black
 * screen before anything can even be asked for.
 *
 * Past the budget the document goes out without them, and the run finishes
 * into the cache regardless: reopening the video has them. A short wait rather
 * than none because a video whose subtitles are already on disk answers
 * instantly, and that is most of a library.
 */
const CAPTION_BUDGET_MS = 2_500;

/**
 * Which subtitles this video can offer right now, and at what cost.
 *
 * The web player asks for the languages when the menu is opened, so nothing is
 * resolved until somebody wants it. A native client has no such moment: the
 * captions it will ever show are the ones declared in this document. So a
 * video with no file on disk pays one resolution here — bounded, and a failure
 * is logged and dropped, because subtitles nobody could list is not a reason to
 * refuse to play the video.
 */
async function captionLanguages(userId: number, videoId: string): Promise<string[]> {
  const files = await listSubtitleFiles(videoId);
  if (files.length) return files.map((file) => file.lang);
  try {
    await Promise.race([
      subtitleTracks(userId, videoId),
      new Promise((resolve) => setTimeout(resolve, CAPTION_BUDGET_MS)),
    ]);
  } catch (error) {
    log.warn("invidious.captions_unresolved", { videoId, error: error instanceof Error ? error.message : String(error) });
  }
  return subtitleLanguages(knownSubtitleTracks(userId, videoId));
}

/**
 * Have something ready before the player asks for it.
 *
 * Both ways of serving a video cost seconds before their first byte — an
 * extraction, or a download — and a native player asks a moment after reading
 * this document, then hangs up rather than wait. Opening a video is intent to
 * play it, so the work starts here, beside the subtitle resolution this
 * request already waits on.
 */
export function warmMedia(userId: number, videoId: string): void {
  void (async () => {
    if (alreadyPlayable(cachedMedia(videoId, "muxed", BEST_HEIGHT), await getDownload(userId, videoId))) return;
    warmFromYouTube(userId, videoId);
  })().catch(() => {});
}

/**
 * Whether this video can already be played without asking YouTube anything.
 *
 * A copy kept on disk is the whole point of keeping it. Warming past one meant
 * every opened video paid an extraction and, seconds later, downloaded a file
 * that was already there — on an address that is being watched for robots.
 */
export function alreadyPlayable(
  cached: string | null,
  download: { status?: string | null; path?: string | null } | null,
): boolean {
  if (cached) return true;
  return download?.status === "done" && Boolean(download.path) && existsSync(download.path!);
}

function warmFromYouTube(userId: number, videoId: string): void {
  let served = false;
  const probe = directResponse(userId, videoId, "bytes=0-1", new AbortController().signal)
    .then((response) => {
      served = Boolean(response);
      return response?.body?.cancel().catch(() => {});
    })
    .catch(() => {});
  // Nothing to wait for while the address is refused, or while the last videos
  // were: the extraction the grace hopes for is the one already failing.
  const fallback = Bun.sleep(directGrace()).then(() => {
    // Cheap when it turns out to be unnecessary: the file is capped, evicted
    // least-recently-served first, and makes the next play of it instant.
    // The quality a client asks for first, so the warm one is the one wanted.
    if (!served) startFetch(userId, videoId, "muxed", BEST_HEIGHT);
  });
  void Promise.all([probe, fallback]).catch(() => {});
}

/**
 * One video, as a client expects to receive it.
 *
 * The stream it names is this server's own, never YouTube's. A CDN link
 * resolved with this instance's cookies answers 403 to the phone that would
 * follow it, and a client seeing a `googlevideo.com` host starts second-
 * guessing us — Yattee probes such a link with HEAD and rewrites its host to
 * proxy through the instance. Pointing at ourselves from the start is both
 * what works and what keeps the client out of the decision.
 */
export async function videoDetail(userId: number, row: DetailRow, origin: string) {
  const downloaded = await getDownload(userId, row.video_id);
  const live = row.live_status === "live";
  const languages = await captionLanguages(userId, row.video_id);
  return {
    ...videoFromRow(row),
    descriptionHtml: row.description ?? "",
    authorThumbnails: channelThumbnails(row.channel_thumbnail),
    authorVerified: false,
    subCountText: row.channel_subscriber_count ?? "",
    allowRatings: true,
    isFamilyFriendly: true,
    isListed: true,
    genre: "",
    keywords: [] as string[],
    /*
     * One entry per quality that can be served as a single muxed file, each
     * saying its height.
     *
     * The height is not decoration: a client's downloader keeps only the
     * streams that declare one — `resolution != nil` — so an entry without it
     * is invisible to it, and asking to download the video fails before any
     * request reaches this server. It is also what lets the viewer choose,
     * since the link carries the choice and the fetch honours it.
     */
    formatStreams: live ? [] : await Promise.all(
      labelledQualities(OFFERED_HEIGHTS, (asked) => cachedEntry(row.video_id, "muxed", asked)?.height ?? null)
        .map(async ({ asked, label }) => ({
          // The link asks for what selects the file; the label says what it is.
          url: await signedMediaUrl(origin, row.video_id, asked),
          itag: label >= 720 ? "22" : "18",
          type: "video/mp4",
          container: "mp4",
          quality: label >= 720 ? "hd720" : "medium",
          qualityLabel: `${label}p`,
          resolution: `${label}p`,
          size: `${Math.round((label * 16) / 9)}x${label}`,
        })),
    ),
    /*
     * The qualities that exist only as separate tracks.
     *
     * A client downloads these as two files and keeps them side by side — it
     * asks for an audio track itself whenever the video one carries no sound —
     * and its player pairs them, choosing a video-only stream only when the
     * backend in use supports one. So resolution above what YouTube muxes
     * costs nothing here: no assembly, two ordinary downloads.
     */
    adaptiveFormats: live ? [] : [
      ...await Promise.all(
        labelledQualities(ADAPTIVE_HEIGHTS, (asked) => cachedEntry(row.video_id, "video", asked)?.height ?? null)
          .map(async ({ asked, label }) => ({
            url: await signedMediaUrl(origin, row.video_id, asked, "video"),
            itag: "137",
            type: 'video/mp4; codecs="avc1.640028"',
            container: "mp4",
            encoding: "h264",
            resolution: `${label}p`,
            qualityLabel: `${label}p`,
            fps: 30,
          })),
      ),
      {
        url: await signedMediaUrl(origin, row.video_id, BEST_HEIGHT, "audio"),
        itag: "140",
        // A client reads this and nothing else to know a track carries no
        // picture: `type` starting with "audio/" is the whole test.
        type: 'audio/mp4; codecs="mp4a.40.2"',
        container: "m4a",
        encoding: "aac",
        audioQuality: "AUDIO_QUALITY_MEDIUM",
        bitrate: "128000",
      },
    ],
    captions: await Promise.all(languages.map(async (language) => ({
      label: language,
      languageCode: language,
      url: await signedCaptionPath(row.video_id, language),
    }))),
    storyboards: [] as unknown[],
    recommendedVideos: [] as unknown[],
    dashUrl: "",
  };
}
