/**
 * How old something is, in the unit somebody would say it in.
 *
 * Months used to be days ÷ 30 and years days ÷ 365, and between those two
 * approximations there is a gap. A video published on 20 August 2025, read on
 * 18 August 2026, is 363 days old:
 *
 *     months = ⌊363 / 30⌋  = 12   → too many to still say months
 *     years  = ⌊363 / 365⌋ =  0   → not enough to say one year
 *
 * so the card read "il y a 0 a" for five days of every year, on every video.
 * Counting calendar months instead closes it: the same video is 11 months old,
 * which is what YouTube says about it too.
 */
export function calendarMonthsBetween(from: Date, to: Date): number {
  const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  // The month is only complete once its day of the month has come round.
  return to.getDate() < from.getDate() ? months - 1 : months;
}

/**
 * The number and the unit to say it in. Anything under a month stays on the
 * clock arithmetic it was already using — a day is a day whatever month it
 * falls in, and only months and years have edges that move.
 */
export function timeAgoParts(from: Date, to: Date): [number, Intl.RelativeTimeFormatUnit] {
  const minutes = Math.floor((to.getTime() - from.getTime()) / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 60) return [minutes, "minute"];
  if (hours < 24) return [hours, "hour"];
  if (days < 30) return [days, "day"];
  const months = calendarMonthsBetween(from, to);
  const years = Math.floor(months / 12);
  // A thirty-day gap that lands inside one calendar month — 15 January to 14
  // February — counts as no complete month. It is still not "0 months old".
  return years < 1 ? [Math.max(1, months), "month"] : [years, "year"];
}
