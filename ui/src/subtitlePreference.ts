/**
 * The subtitle track to turn on for a reader who wants a language.
 *
 * YouTube tags a dubbed video's tracks with a region — `fr-FR`, `es-ES` — so a
 * reader asking for `fr` often finds no track named exactly that. Falling
 * straight to the first track in the list then turns on whatever sorts first,
 * which on one dubbed video was Indonesian. The same language under another
 * region is what the reader asked for; the first track is only for when the
 * language is not there at all.
 */
export function preferredSubtitle(subs: readonly { lang: string }[], language: string | null | undefined): string | null {
  if (!subs.length) return language ?? null;
  if (!language) return subs[0].lang;
  const exact = subs.find((sub) => sub.lang === language);
  if (exact) return exact.lang;
  const base = language.split("-")[0].toLowerCase();
  const sameLanguage = subs.find((sub) => sub.lang.split("-")[0].toLowerCase() === base);
  return (sameLanguage ?? subs[0]).lang;
}
