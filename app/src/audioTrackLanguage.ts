import { getUserSetting } from "./db";

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
  const language = getUserSetting(userId, "language");
  return typeof language === "string" && /^[a-z]{2}$/.test(language) ? language : "en";
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
