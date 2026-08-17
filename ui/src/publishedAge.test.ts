import { describe, expect, test } from "bun:test";
import { calendarMonthsBetween, timeAgoParts } from "./publishedAge";

const at = (iso: string) => new Date(iso);

describe("the gap between twelve months and one year", () => {
  test("the video that was reported as 0 years old", () => {
    // DFnKRqlaGuE, published 20 August 2025, read on 18 August 2026: 363 days.
    // Days ÷ 30 said twelve months, days ÷ 365 said zero years, and the card
    // took the second. YouTube says 11 months about the same video.
    expect(timeAgoParts(at("2025-08-20T10:00:17Z"), at("2026-08-18T09:00:00Z"))).toEqual([11, "month"]);
  });

  test("every day of that gap, not just the one reported", () => {
    // 360 to 364 days: months ÷ 30 has reached 12, years ÷ 365 is still 0.
    for (const day of [18, 19, 20]) {
      const [value, unit] = timeAgoParts(at("2025-08-20T10:00:00Z"), at(`2026-08-${day}T10:00:00Z`));
      expect(unit === "month" ? value >= 11 : value >= 1).toBe(true);
    }
  });

  test("a year is a year once the day comes round", () => {
    expect(timeAgoParts(at("2025-08-20T10:00:00Z"), at("2026-08-20T10:00:00Z"))).toEqual([1, "year"]);
    expect(timeAgoParts(at("2023-08-20T10:00:00Z"), at("2026-08-21T10:00:00Z"))).toEqual([3, "year"]);
  });
});

describe("counting calendar months", () => {
  test("a month is complete when its day of the month comes round", () => {
    expect(calendarMonthsBetween(at("2026-01-15T00:00:00Z"), at("2026-02-14T00:00:00Z"))).toBe(0);
    expect(calendarMonthsBetween(at("2026-01-15T00:00:00Z"), at("2026-02-15T00:00:00Z"))).toBe(1);
  });

  test("short months do not cost a month", () => {
    // 31 January to 1 March is more than a month however February was counted.
    expect(calendarMonthsBetween(at("2026-01-31T00:00:00Z"), at("2026-03-01T00:00:00Z"))).toBe(1);
  });

  test("thirty days inside one calendar month is still not nothing", () => {
    // 15 January to 14 February: no complete calendar month, but far too old to
    // be shown in days, and "0 months" is not a thing anybody says.
    expect(timeAgoParts(at("2026-01-15T00:00:00Z"), at("2026-02-14T00:00:00Z"))).toEqual([1, "month"]);
  });
});

describe("everything under a month is unchanged", () => {
  test("minutes, hours and days read as they did", () => {
    expect(timeAgoParts(at("2026-08-18T09:00:00Z"), at("2026-08-18T09:42:00Z"))).toEqual([42, "minute"]);
    expect(timeAgoParts(at("2026-08-18T00:00:00Z"), at("2026-08-18T09:00:00Z"))).toEqual([9, "hour"]);
    expect(timeAgoParts(at("2026-08-01T00:00:00Z"), at("2026-08-18T00:00:00Z"))).toEqual([17, "day"]);
  });

  test("twenty-nine days is days, thirty is months", () => {
    expect(timeAgoParts(at("2026-07-20T00:00:00Z"), at("2026-08-18T00:00:00Z"))).toEqual([29, "day"]);
    expect(timeAgoParts(at("2026-07-19T00:00:00Z"), at("2026-08-18T00:00:00Z"))).toEqual([1, "month"]);
    expect(timeAgoParts(at("2026-07-18T00:00:00Z"), at("2026-08-18T00:00:00Z"))).toEqual([1, "month"]);
  });
});
