import { getUserSetting } from "./db";
import { normalizeLanguage } from "../../shared/uiLanguages";
import { resolvePlayerLanguage } from "../../shared/playerLanguage";

/**
 * Which audio track a profile should get, when a video carries several.
 *
 * YouTube dubs a growing number of videos: the same upload carries an original
 * track and a dozen translations, each a separate format tagged with its
 * language. Asked for the best audio and nothing else, yt-dlp answers with the
 * original — English, on a French instance, for a video that has a French
 * track sitting beside it.
 *
 * The embed cannot be helped: its public API has ten methods and none of them
 * touches audio tracks, so a video played through YouTube's own iframe is
 * played in whatever YouTube decides. Everything played through here can be
 * asked properly, and this is what asking properly looks like.
 */
export function audioLanguageFor(userId: number): string {
  // The player's language, which follows the profile unless one was chosen:
  // one setting for the dub, the captions and the embed's own controls.
  const profile = normalizeLanguage(getUserSetting(userId, "language"));
  const language = resolvePlayerLanguage(getUserSetting(userId, "player_hl"), profile).split("-")[0].toLowerCase();
  return /^[a-z]{2}$/.test(language) ? language : "en";
}

/**
 * A format selector that prefers the reader's language and settles for the
 * original.
 *
 * The fallbacks matter more than the preference: most videos carry one track,
 * tagged with the language it was made in, and asking for French on a video
 * that is only in English must not come back empty-handed.
 */
export function audioSelectorFor(language: string, base = "bestaudio[acodec^=mp4a]"): string {
  return [
    `${base}[language^=${language}]`,
    `bestaudio[language^=${language}]`,
    base,
    "bestaudio[ext=m4a]",
    "140",
    "bestaudio",
    "best",
  ].join("/");
}

/**
 * The same preference for a picture and its sound fetched separately.
 *
 * A download, and the local player's HLS streams, ask for the best video and
 * the best audio as two formats. Asked that way, yt-dlp answers with the
 * original track, whatever the reader reads. This is the alternative to put in
 * front of the caller's own selector: the same pair with the audio held to the
 * reader's language, so a video with that dub gets it and every other video
 * falls through to exactly what the caller asked for before.
 */
export function preferDubbedAudio(video: string, audio: string, language: string): string {
  return `${video}+${audio}[language^=${language}]/`;
}
