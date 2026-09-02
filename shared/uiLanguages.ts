/**
 * Canonical UI-language contract shared by the browser and the server.
 *
 * Keep this module dependency-free: both independently built applications import
 * it, and deployment packaging copies it alongside their source trees.
 */
export const UI_LANGUAGES = {
  en: { locale: "en-US", nativeName: "English", base: "en" },
  pl: { locale: "pl-PL", nativeName: "polski", base: "pl" },
  de: { locale: "de-DE", nativeName: "Deutsch", base: "de" },
  fr: { locale: "fr-FR", nativeName: "Français", base: "fr" },
  es: { locale: "es-ES", nativeName: "Español", base: "es" },
  "pt-BR": { locale: "pt-BR", nativeName: "Português (Brasil)", base: "pt" },
  ru: { locale: "ru-RU", nativeName: "Русский", base: "ru" },
  ja: { locale: "ja-JP", nativeName: "日本語", base: "ja" },
  hu: { locale: "hu-HU", nativeName: "Magyar", base: "hu" },
} as const;

export type Language = keyof typeof UI_LANGUAGES;

export const LANGUAGE_CODES = Object.keys(UI_LANGUAGES) as Language[];

export const LOCALE_TAGS: Record<Language, string> = Object.fromEntries(
  LANGUAGE_CODES.map((code) => [code, UI_LANGUAGES[code].locale]),
) as Record<Language, string>;

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && value in UI_LANGUAGES;
}

export function normalizeLanguage(value: unknown): Language {
  return isLanguage(value) ? value : "en";
}
