/**
 * The language the player is asked to speak.
 *
 * YouTube reads it from the embed's `hl`, and on a dubbed video that decides
 * more than the controls: it picks which audio track plays and which caption
 * track comes up with it. A French reader handed `hl=en` gets the English dub
 * and English subtitles on a video that carries a French one beside them.
 *
 * `profile` means the language this profile reads the interface in, the same
 * rule the titles already follow (`youtube_title_language`). A language
 * chosen explicitly is kept as it was chosen.
 *
 * Keep this module dependency-free: both independently built applications
 * import it, and deployment packaging copies it alongside their source trees.
 */
export const PROFILE_PLAYER_LANGUAGE = "profile";

/** Resolve a stored player language against the profile's interface language. */
export function resolvePlayerLanguage(setting: unknown, interfaceLanguage: string): string {
  return typeof setting === "string" && setting !== "" && setting !== PROFILE_PLAYER_LANGUAGE
    ? setting
    : interfaceLanguage;
}
