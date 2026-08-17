import { panelLanguage, type PanelLanguage } from "./relatedVideoText";

/**
 * The language the shared library is written in.
 *
 * YouTube translates a video's title into whatever language the request asks
 * for. Asked in English on a French instance, it hands back an English title
 * for a French video — and `videos.title` is one row shared by every profile,
 * so that title is what the whole household then sees, indefinitely: a video
 * old enough to have fallen out of its channel's feed is never re-read.
 *
 * One row means one language, so this is deliberately not a per-profile
 * setting: it is the language the library is kept in. The primary profile's own
 * choice is the sensible default — it is whoever set the instance up — and
 * `YOUTUBE_METADATA_LANGUAGE`, or `YTZERO_YT_LANGUAGE`, overrides it for a
 * household whose library should be kept in a language nobody's interface
 * happens to use.
 */
let languageProvider: () => PanelLanguage = () => "en";

export function configureLibraryLanguageProvider(provider: () => PanelLanguage): void {
  languageProvider = provider;
}

export function libraryLanguage(): PanelLanguage {
  // Both names, because an instance already set up with either one should not
  // have to be set up again: `YTZERO_YT_LANGUAGE` is what upstream reads.
  const override = process.env.YOUTUBE_METADATA_LANGUAGE ?? process.env.YTZERO_YT_LANGUAGE;
  if (override) return panelLanguage(override.trim().toLowerCase().slice(0, 2));
  return languageProvider();
}
