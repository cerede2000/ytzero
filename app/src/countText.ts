/**
 * Read a count the way YouTube writes it, in any of the languages it is asked
 * in.
 *
 * Two parsers grew here, each written for one caller and each right about its
 * own: one that knew the four languages but insisted the whole string be a
 * number and the word "views", and one that read a number anywhere but knew
 * three magnitudes out of ten. Measured against real answers, both failed —
 * and the second failed the worse way, by returning a number:
 *
 *     620 Tsd. Abonnenten   ->  620      a channel with 620 000 subscribers
 *     1 234 vues            ->  1        a video with 1 234 views
 *
 * A wrong number is worse than none. Nothing downstream refuses it, because
 * there is nothing about it to refuse: it is simply displayed.
 *
 * So there is one reader, and it knows the whole table. What it cannot read it
 * declines to guess at.
 */

/**
 * Every magnitude YouTube writes in the four languages the app speaks, lower
 * cased and without the abbreviating full stop.
 *
 *     en  K       M       B
 *     fr  k       M       Md
 *     de  Tsd.    Mio.    Mrd.
 *     pl  tys.    mln     mld
 */
const MAGNITUDES: Record<string, number> = {
  k: 1e3, tsd: 1e3, tys: 1e3,
  m: 1e6, mio: 1e6, mln: 1e6,
  b: 1e9, md: 1e9, mrd: 1e9, mld: 1e9,
};

/** Every space YouTube groups thousands with, the narrow ones included. */
const SPACES = /[\s\u00a0\u202f\u2009]/g;

/**
 * A number, and the word that may follow it.
 *
 * The digits are taken as far as separator-then-digits carries them, so
 * "1 234" is one number and "2 semaines" is one digit followed by a word. The
 * word is only read when the table above knows it, so "620 subscribers" reads
 * six hundred and twenty and "620 Tsd." reads six hundred and twenty thousand.
 */
const NUMBER_THEN_WORD = /(\d+(?:[.,\u00a0\u202f\u2009 ]\d+)*)\s*(\p{L}+\.?)?/u;

/**
 * Whether the separators in a number group thousands rather than open decimals.
 *
 * The same comma means both, depending on the language, so the shape decides
 * rather than the language: three digits behind the last separator is a group
 * ("1,234", "4.700.000"), one or two are decimals ("4,7", "1.2"). A magnitude
 * settles it on its own — nobody writes "4,700 M".
 */
function groupsThousands(digits: string, hasMagnitude: boolean): boolean {
  if (hasMagnitude) return false;
  const last = Math.max(digits.lastIndexOf(","), digits.lastIndexOf("."));
  if (last < 0) return true;
  return /^\d{3}$/.test(digits.slice(last + 1));
}

/**
 * The count this text carries, or nothing.
 *
 * `bare` is for a caller that has already decided the whole string is a count
 * and nothing else — the suggestion panel, where a date sits in the same list
 * and "il y a 2 semaines" must not be read as two.
 */
export function readCount(text: string | undefined, options: { bare?: boolean } = {}): number | null {
  if (!text) return null;
  const cleaned = text.trim();
  const match = cleaned.match(NUMBER_THEN_WORD);
  if (!match) return null;

  const word = match[2]?.toLowerCase().replace(/\.$/, "");
  const magnitude = word ? MAGNITUDES[word] : undefined;
  // A word the table does not know is not part of the number: "620 subscribers"
  // is six hundred and twenty, and the word is somebody else's business.
  if (options.bare) {
    const rest = cleaned.slice(0, match.index ?? 0) + cleaned.slice((match.index ?? 0) + match[0].length);
    if (rest.trim() || (word && magnitude === undefined)) return null;
  }

  const digits = match[1].replace(SPACES, "");
  const normalised = groupsThousands(digits, magnitude !== undefined)
    ? digits.replace(/[.,]/g, "")
    : digits.replace(/[.,](?=\d{1,2}$)/, "\u0000").replace(/[.,]/g, "").replace("\u0000", ".");
  const value = parseFloat(normalised);
  if (!Number.isFinite(value)) return null;
  const total = Math.round(value * (magnitude ?? 1));
  return total > 0 ? total : null;
}
