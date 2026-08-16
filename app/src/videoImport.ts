import type { AudioSource } from "./audioSourceResolver";
import { childHidesLive } from "./childTime";
import { database } from "./database";
import { primeAudioSource, primeVideoSource } from "./downloader";
import { log } from "./logger";
import { askWithBorrowedCredentials } from "./metadataCredentials";
import { persistDirectVideoInfo } from "./videoInfoPersistence";
import { saveRelatedVideos } from "./relatedVideoStore";
import type { RelatedVideo } from "./relatedVideos";
import { fetchVideoInfoViaYtdlp, type ProgressiveVideoSource } from "./videoInfoViaYtdlp";
import { videoExistsStmt } from "./videoRoutesSupport";
import {
  DeletedVideoError,
  fetchChannelAbout,
  fetchChannelFeed,
  fetchVideoInfo,
  PrivateVideoError,
  type VideoInfo,
} from "./youtube";

export class LiveDisabledForProfileError extends Error {
  constructor() {
    super("live streams are disabled for this profile");
    this.name = "LiveDisabledForProfileError";
  }
}

/**
 * Read a video's details for an import, through yt-dlp if YouTube will not
 * answer us directly. A video that is not in the library cannot be opened at
 * all until this succeeds, and yt-dlp — with the profile's cookies and a
 * proof-of-origin token — gets an answer where a plain request is refused.
 * Only a refusal is worth the second attempt: a video that is private or gone
 * says so consistently, and asking twice would just be slower.
 *
 * "The profile's cookies" is the part that fails quietly. A profile with no
 * jar makes one anonymous attempt, is refused in two seconds, and the video
 * will not open — while the same video opens for the profile next door. On an
 * instance where one person set up cookies and the second profile did not, the
 * second profile simply cannot open anything outside the library, and nothing
 * on screen says why.
 *
 * So the instance falls back on the credentials it already borrows elsewhere:
 * the background metadata jobs and the suggestion panel both do this, and this
 * is the one that decides whether somebody can watch. The cost is one more
 * yt-dlp run, paid only when the first found nothing, and only when a
 * different profile has a jar to lend.
 */
async function fetchVideoInfoForImport(userId: number, videoId: string, related: { videos: RelatedVideo[] }): Promise<VideoInfo> {
  try {
    return await fetchVideoInfo(videoId, { related });
  } catch (error) {
    if (error instanceof PrivateVideoError || error instanceof DeletedVideoError) throw error;
    const audio: { source: AudioSource | null } = { source: null };
    const video: { source: ProgressiveVideoSource | null } = { source: null };
    const viaYtdlp = await askWithBorrowedCredentials(
      userId,
      (asUserId) => fetchVideoInfoViaYtdlp(asUserId, videoId, Bun.spawn, audio, video).catch(() => null),
      undefined,
      (lender) => log.info("video.import_via_borrowed_credentials", { videoId, userId, lender }),
    );
    if (!viaYtdlp) throw error;
    // The answer carried both playable tracks too. Handing them over here is
    // the difference between a player that starts and one that waits for the
    // same question to be asked again, whichever of the two the page picks.
    // They are primed for whoever is watching: the tracks are the video's, not
    // the account's, whichever account got them handed over.
    if (audio.source) primeAudioSource(userId, videoId, audio.source);
    if (video.source) primeVideoSource(userId, videoId, video.source);
    return viaYtdlp;
  }
}

async function loadAndPersistVideoInfo(userId: number, videoId: string): Promise<VideoInfo> {
  // The watch page carries YouTube's own panel of suggestions, and this import
  // is the one moment that page is downloaded. Reading it here is the whole
  // cost of the related panel; asking for it later would be a request.
  const related: { videos: RelatedVideo[] } = { videos: [] };
  const info = await fetchVideoInfoForImport(userId, videoId, related);
  if (childHidesLive(userId) && info.liveStatus !== "none") throw new LiveDisabledForProfileError();
  // Channel avatar + the channel's recent uploads (for the "related" panel).
  const [about, feed] = await Promise.all([
    fetchChannelAbout(info.channelId).catch(() => null),
    fetchChannelFeed(info.channelId).catch(() => null),
  ]);
  const avatar = about?.avatar ?? "";

  // Upsert channel: insert as external if new, or update avatar if missing
  await database.prepare(`
    INSERT INTO channels (channel_id, title, url, thumbnail, followed, external)
    VALUES (?, ?, ?, ?, 0, 1)
    ON CONFLICT(channel_id) DO UPDATE SET
      thumbnail = CASE WHEN channels.thumbnail = '' OR channels.thumbnail IS NULL
                       THEN excluded.thumbnail ELSE channels.thumbnail END
  `).run(info.channelId, info.channelTitle, `https://www.youtube.com/channel/${info.channelId}`, avatar);

  const insertRelatedVideo = database.prepare(`
    INSERT OR IGNORE INTO videos
      (video_id, channel_id, title, description, thumbnail, published_at, live_status, status, views, duration, external)
    VALUES (?, ?, ?, ?, ?, ?, 'none', 'inbox', ?, ?, 1)
  `);

  // The directly requested player response is authoritative for live state,
  // even when RSS imported this row earlier without a live marker.
  const existing = await videoExistsStmt.get(info.videoId);
  await persistDirectVideoInfo(info);

  // Insert the channel's recent uploads as external so the related panel fills.
  if (feed) {
    const insertMany = database.transaction(async (videos: typeof feed.videos) => {
      for (const v of videos) {
        await insertRelatedVideo.run(
          v.videoId, info.channelId, v.title, v.description,
          v.thumbnail, v.publishedAt, v.views, null
        );
      }
    });
    await insertMany(feed.videos);
  }
  // After the row exists: the panel points at it by foreign key.
  await saveRelatedVideos(info.videoId, related.videos);
  log.info("external.video_info_loaded", {
    videoId: info.videoId,
    channelId: info.channelId,
    inserted: !existing,
    relatedImported: feed?.videos.length ?? 0,
    relatedSuggestions: related.videos.length,
  });
  return info;
}

/**
 * One import per profile and video at a time.
 *
 * Opening the same video twice in quick succession — a card tapped twice, two
 * devices, a page that remounts — started a second extraction while the first
 * was still running: five more seconds of yt-dlp for an answer that was
 * already on its way, and a second round of channel lookups behind it.
 * Whoever asks second waits for the first answer instead.
 *
 * The answer is then remembered for a minute. Holding it only while it ran
 * left the sharpest case uncovered: queueing a video and opening it are two
 * asks a second apart, and the second one arrived just as the first finished —
 * far enough behind to miss the running import, near enough that the answer it
 * paid five seconds for was the one already written down.
 *
 * A minute is short enough that asking again is still how the related panel is
 * refilled: that happens when a video is opened long after its siblings were
 * cleared, not seconds after it was imported.
 */
const IMPORT_MEMORY_MS = 60_000;

export function createVideoImporter(load = loadAndPersistVideoInfo, now: () => number = Date.now) {
  const inFlight = new Map<string, Promise<VideoInfo>>();
  const answered = new Map<string, { at: number; info: VideoInfo }>();
  return function importVideo(userId: number, videoId: string): Promise<VideoInfo> {
    const key = `${userId}:${videoId}`;
    const running = inFlight.get(key);
    if (running) return running;
    const remembered = answered.get(key);
    if (remembered && now() - remembered.at < IMPORT_MEMORY_MS) return Promise.resolve(remembered.info);
    const started = load(userId, videoId);
    inFlight.set(key, started);
    // Registered on the import itself rather than on a chain after it, so it
    // is forgotten before the caller that was waiting gets to run again.
    const forget = () => { if (inFlight.get(key) === started) inFlight.delete(key); };
    started.then((info) => {
      forget();
      // Swept on each write: nothing here outlives its minute, so a long run
      // does not accumulate an entry per video ever imported.
      for (const [seen, entry] of answered) if (now() - entry.at >= IMPORT_MEMORY_MS) answered.delete(seen);
      answered.set(key, { at: now(), info });
    }, forget);
    return started;
  };
}

export const importVideo = createVideoImporter();

/**
 * Make sure a video is in the library before something is asked of it.
 *
 * A video can be seen before it is imported — a search result is a card like
 * any other — and downloading it, scheduling it or filing it in a playlist all
 * need the row that opening it would have created. Doing that here means the
 * action succeeds from wherever the video was seen, rather than answering "not
 * found" for something plainly on screen.
 *
 * An import costs an extraction, so it is only paid for when the row really is
 * missing; a video already in the library is left exactly as it is.
 */
export async function ensureVideoImported(
  userId: number,
  videoId: string,
  inLibrary: (videoId: string) => Promise<unknown> = (id) => videoExistsStmt.get(id),
  load: (userId: number, videoId: string) => Promise<unknown> = importVideo,
): Promise<boolean> {
  if (await inLibrary(videoId)) return true;
  try {
    await load(userId, videoId);
    return true;
  } catch (error) {
    log.warn("external.video_import_for_action_failed", { videoId, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}
