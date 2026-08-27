import { panelLanguage, type PanelLanguage } from "./relatedVideoText";

/**
 * The language a search is answered in.
 *
 * A video whose channel publishes a translated title has more than one, and
 * YouTube hands back the one the request named. The page doing the asking is
 * rendering in a language already, so it says which on the request and that is
 * the one used — the profile's stored setting is the fallback for callers that
 * cannot say, such as another client speaking the Invidious dialect.
 *
 * The two disagree more often than they should: a row that was never written,
 * a settings fetch that failed and left the interface on its remembered
 * language, a household set up before the setting existed. When they disagree,
 * the language on screen is the true one — nobody reading French asked for an
 * English title.
 */
export function languageAsked(asked: string | null | undefined, fallback: PanelLanguage): PanelLanguage {
  if (!asked) return fallback;
  return panelLanguage(asked.trim().toLowerCase().slice(0, 2));
}
