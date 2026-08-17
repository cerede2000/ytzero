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
export type PanelLanguage = "en" | "fr" | "de" | "pl";

export function panelLanguage(value: string | null | undefined): PanelLanguage {
  return value === "fr" || value === "de" || value === "pl" ? value : "en";
}

export function acceptLanguage(language: PanelLanguage): string {
  return { en: "en-US,en;q=0.9", fr: "fr-FR,fr;q=0.9", de: "de-DE,de;q=0.9", pl: "pl-PL,pl;q=0.9" }[language];
}

interface Grammar {
  /** Captures the number and the unit token, in that order. */
  ago: RegExp;
  units: Record<string, PublishedAgo["unit"]>;
  /** Longest suffix first, so "mo" is read before "m". */
  magnitudes: Array<[string, number]>;
  /** Whether a comma separates the decimals rather than the thousands. */
  decimalComma: boolean;
}

const GRAMMARS: Record<PanelLanguage, Grammar> = {
  en: {
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
    magnitudes: [["b", 1e9], ["m", 1e6], ["k", 1e3]],
    decimalComma: false,
  },
  fr: {
    ago: /^il y a\s+(\d+)\s*(s|min|h|j|sem|mois|ans|an)\.?$/i,
    units: { s: "second", min: "minute", h: "hour", j: "day", sem: "week", mois: "month", an: "year", ans: "year" },
    magnitudes: [["md", 1e9], ["mrd", 1e9], ["m", 1e6], ["k", 1e3]],
    decimalComma: true,
  },
  de: {
    ago: /^vor\s+(\d+)\s*(sek|min|std|tagen|tag|tg|wochen|wo|monaten|mon|jahren|jahr|j)\.?$/i,
    units: { sek: "second", min: "minute", std: "hour", tag: "day", tagen: "day", tg: "day", wo: "week", wochen: "week", mon: "month", monaten: "month", j: "year", jahr: "year", jahren: "year" },
    magnitudes: [["mrd", 1e9], ["mio", 1e6], ["tsd", 1e3]],
    decimalComma: true,
  },
  pl: {
    ago: /^(\d+)\s*(sek|min|godz|dni|dnia|dzień|tyg|mies|lata|lat|rok)\.?\s+temu$/i,
    units: { sek: "second", min: "minute", godz: "hour", "dzień": "day", dni: "day", dnia: "day", tyg: "week", mies: "month", rok: "year", lata: "year", lat: "year" },
    magnitudes: [["mld", 1e9], ["mln", 1e6], ["tys", 1e3]],
    decimalComma: true,
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

export function parseCompactCount(text: string | undefined, language: PanelLanguage = "en"): number | null {
  const grammar = GRAMMARS[language];
  const trimmed = text?.trim().replace(SPACES, "");
  if (!trimmed) return null;
  const match = trimmed.match(/^([\d.,]+)([\p{L}]*)\.?$/u);
  if (!match) return null;
  const suffix = match[2].toLowerCase().replace(/\.$/, "");
  const multiplier = suffix === ""
    ? 1
    : grammar.magnitudes.find(([name]) => name === suffix)?.[1];
  if (multiplier === undefined) return null;
  // "1,6" is one and six tenths in French and one thousand six hundred in
  // English; the same two characters, opposite meanings.
  const digits = grammar.decimalComma ? match[1].replace(/\./g, "").replace(",", ".") : match[1].replace(/,/g, "");
  const value = parseFloat(digits);
  if (!Number.isFinite(value)) return null;
  const total = Math.round(value * multiplier);
  return total > 0 ? total : null;
}

export function looksLikeCount(text: string, language: PanelLanguage): boolean {
  return parseCompactCount(text, language) !== null;
}

export function looksLikePublished(text: string, language: PanelLanguage): boolean {
  return parseCompactPublishedText(text, language) !== null;
}
