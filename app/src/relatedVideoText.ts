import { readCount } from "./countText";
import type { PublishedAgo } from "./youtube";

/**
 * Reading the side panel in the language it was asked for.
 *
 * The panel is fetched in the reader's own language, because the title is the
 * one thing taken from it verbatim — asked for in English, YouTube hands back
 * an auto-translated title, and a French reader gets "Why the Rafale Worries
 * the Americans So Much" for a video called "Pourquoi le Rafale inquiète
 * autant les Américains".
 *
 * Everything else on the card is stored as a number and rendered by the
 * interface, so the only cost of asking in another language is here: the
 * count and the age arrive written the way that language writes them. And the
 * channel is found by elimination — whichever part is neither of those — so a
 * grammar that does not know the language does not merely lose the age, it
 * starts reading the age as the channel's name.
 */
export const PANEL_LANGUAGES = ["en", "fr", "de", "pl"] as const;
export type PanelLanguage = (typeof PANEL_LANGUAGES)[number];

export function panelLanguage(value: string | null | undefined): PanelLanguage {
  return value === "fr" || value === "de" || value === "pl" ? value : "en";
}

export function acceptLanguage(language: PanelLanguage): string {
  return { en: "en-US,en;q=0.9", fr: "fr-FR,fr;q=0.9", de: "de-DE,de;q=0.9", pl: "pl-PL,pl;q=0.9" }[language];
}

interface Grammar {
  /**
   * The word each language puts after a view count.
   *
   * The watch page's lockups write the count bare — "699K", "699 k" — but the
   * same count arrives from YouTube's own endpoint spelled out, "699 k vues".
   * Read without allowing for it, the count is unreadable and the card loses
   * its view count and its age; worse, a text that is neither a count nor an
   * age is what the channel is found by, so the elimination starts guessing.
   */
  views: RegExp;
  /** Captures the number and the unit token, in that order. */
  ago: RegExp;
  units: Record<string, PublishedAgo["unit"]>;
}

const GRAMMARS: Record<PanelLanguage, Grammar> = {
  en: {
    views: /\s*views?$/i,
    // The panel writes "1mo ago"; the watch page sometimes spells it out.
    ago: /^(\d+)\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?|sec|min|hr|mo|s|m|h|d|w|y)\s*ago$/i,
    units: {
      s: "second", sec: "second", second: "second", seconds: "second",
      m: "minute", min: "minute", minute: "minute", minutes: "minute",
      h: "hour", hr: "hour", hour: "hour", hours: "hour",
      d: "day", day: "day", days: "day",
      w: "week", week: "week", weeks: "week",
      mo: "month", month: "month", months: "month",
      y: "year", year: "year", years: "year",
    },
  },
  /*
   * Each language carries both the short forms the suggestion panel writes and
   * the spelled-out ones a channel page writes: "il y a 4 j" beside "il y a 4
   * jours". They are the same grammar seen at two sizes, and a table that knows
   * only the small one reads a channel page as having no dates at all.
   *
   * Longest alternative first — "minutes" before "min", "jahren" before "jahr"
   * — so the end anchor is never reached by a prefix that merely started well.
   */
  fr: {
    views: /\s*(?:de\s+)?vues?$/i,
    ago: /^il y a\s+(\d+)\s*(secondes?|minutes?|heures?|jours?|semaines?|mois|ans?|sem|min|s|h|j)\.?$/i,
    units: {
      s: "second", seconde: "second", secondes: "second",
      min: "minute", minute: "minute", minutes: "minute",
      h: "hour", heure: "hour", heures: "hour",
      j: "day", jour: "day", jours: "day",
      sem: "week", semaine: "week", semaines: "week",
      mois: "month",
      an: "year", ans: "year",
    },
  },
  de: {
    views: /\s*Aufrufe?$/i,
    ago: /^vor\s+(\d+)\s*(sekunden?|minuten?|stunden?|monaten|monat|wochen|woche|jahren|jahre|jahr|tagen|tage|tag|sek|min|std|mon|wo|tg|j)\.?$/i,
    units: {
      sek: "second", sekunde: "second", sekunden: "second",
      min: "minute", minute: "minute", minuten: "minute",
      std: "hour", stunde: "hour", stunden: "hour",
      tag: "day", tage: "day", tagen: "day", tg: "day",
      wo: "week", woche: "week", wochen: "week",
      mon: "month", monat: "month", monaten: "month",
      j: "year", jahr: "year", jahre: "year", jahren: "year",
    },
  },
  pl: {
    views: /\s*wyświetle(?:ń|nia|nie)$/i,
    ago: /^(\d+)\s*(sekund[ayę]?|minut[yę]?|godzin[yę]?|miesiąc[ae]?|miesięcy|tygodnie|tygodni|tydzień|dzień|dnia|dni|godz|mies|lata|lat|rok|sek|min|tyg)\.?\s+temu$/i,
    units: {
      sek: "second", sekund: "second", sekunda: "second", sekundy: "second", "sekundę": "second",
      min: "minute", minut: "minute", minuty: "minute", "minutę": "minute",
      godz: "hour", godzin: "hour", godziny: "hour", "godzinę": "hour",
      "dzień": "day", dnia: "day", dni: "day",
      tyg: "week", "tydzień": "week", tygodnie: "week", tygodni: "week",
      mies: "month", "miesiąc": "month", "miesiące": "month", "miesięcy": "month",
      rok: "year", lata: "year", lat: "year",
    },
  },
};

/** Every space YouTube uses to group thousands, including the narrow ones. */
const SPACES = /[\s   ]/g;

export function parseCompactPublishedText(text: string | undefined, language: PanelLanguage = "en"): PublishedAgo | null {
  const grammar = GRAMMARS[language];
  const match = text?.trim().replace(SPACES, " ").match(grammar.ago);
  if (!match) return null;
  const unit = grammar.units[match[2].toLowerCase().replace(/\.$/, "")];
  return unit ? { value: parseInt(match[1], 10), unit } : null;
}

/**
 * The same age, read without being told which language wrote it.
 *
 * A page is fetched in one language, but the label can arrive with something in
 * front of it — "Streamed 2 weeks ago", "Diffusé en direct il y a 2 semaines" —
 * so the start anchor is dropped while the end anchor is kept. The end is what
 * makes these safe to read: "ago" and "temu" close the phrase, and "il y a" and
 * "vor" cannot begin one anywhere but at a date.
 */
const UNANCHORED: Array<[PanelLanguage, RegExp]> = PANEL_LANGUAGES.map((language) => [
  language,
  new RegExp(GRAMMARS[language].ago.source.replace(/^\^/, ""), GRAMMARS[language].ago.flags),
]);

export function parsePublishedTextAnyLanguage(text: string | undefined): PublishedAgo | null {
  const cleaned = text?.trim().replace(SPACES, " ");
  if (!cleaned) return null;
  for (const [language, pattern] of UNANCHORED) {
    const match = cleaned.match(pattern);
    if (!match) continue;
    const unit = GRAMMARS[language].units[match[2].toLowerCase().replace(/\.$/, "")];
    if (unit) return { value: parseInt(match[1], 10), unit };
  }
  return null;
}

export function parseCompactCount(text: string | undefined, language: PanelLanguage = "en"): number | null {
  const grammar = GRAMMARS[language];
  const trimmed = text?.trim().replace(grammar.views, "");
  if (!trimmed) return null;
  // `bare`, because this is also the test for whether a metadata part is the
  // count at all: the date sits in the same list, and a date is a number with
  // a word after it too.
  return readCount(trimmed, { bare: true });
}

export function looksLikeCount(text: string, language: PanelLanguage): boolean {
  return parseCompactCount(text, language) !== null;
}

export function looksLikePublished(text: string, language: PanelLanguage): boolean {
  return parseCompactPublishedText(text, language) !== null;
}
