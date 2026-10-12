import { describe, it, expect } from "vitest";
import { EMPTY_DATE_FILTER, inDateRange, parseDMY, presetRange } from "./dateRanges";

const TODAY = new Date(2026, 9, 15); // 15-10-2026 (a Thursday)
const f = (preset: any, from = "", to = "") => ({ preset, from, to });

describe("date range filters", () => {
  it("parses DD-MM-YYYY and rejects impossible dates", () => {
    expect(parseDMY("05-10-2026")).toEqual(new Date(2026, 9, 5));
    expect(parseDMY("2026-10-05")).toEqual(new Date(2026, 9, 5));
    expect(parseDMY("31-02-2026")).toBeNull();
    expect(parseDMY("")).toBeNull();
    expect(parseDMY(undefined)).toBeNull();
  });

  it("an inactive filter lets everything through, even blank dates", () => {
    expect(inDateRange("01-01-2020", EMPTY_DATE_FILTER, TODAY)).toBe(true);
    expect(inDateRange("", EMPTY_DATE_FILTER, TODAY)).toBe(true);
  });

  it("Today / Last 7 days / Next 7 days count today as one of the days", () => {
    expect(inDateRange("15-10-2026", f("today"), TODAY)).toBe(true);
    expect(inDateRange("14-10-2026", f("today"), TODAY)).toBe(false);
    expect(inDateRange("09-10-2026", f("last7"), TODAY)).toBe(true);   // 6 days back
    expect(inDateRange("08-10-2026", f("last7"), TODAY)).toBe(false);
    expect(inDateRange("16-10-2026", f("last7"), TODAY)).toBe(false);
    expect(inDateRange("21-10-2026", f("next7"), TODAY)).toBe(true);   // 6 days ahead
    expect(inDateRange("22-10-2026", f("next7"), TODAY)).toBe(false);
    expect(inDateRange("14-10-2026", f("next7"), TODAY)).toBe(false);
  });

  it("This Month and Next Month cover whole calendar months, including year end", () => {
    expect(presetRange("thisMonth", TODAY)).toEqual({ from: new Date(2026, 9, 1), to: new Date(2026, 9, 31) });
    expect(inDateRange("31-10-2026", f("thisMonth"), TODAY)).toBe(true);
    expect(inDateRange("01-11-2026", f("thisMonth"), TODAY)).toBe(false);
    expect(inDateRange("30-11-2026", f("nextMonth"), TODAY)).toBe(true);
    expect(inDateRange("01-12-2026", f("nextMonth"), TODAY)).toBe(false);
    const dec = new Date(2026, 11, 20);
    expect(presetRange("nextMonth", dec)).toEqual({ from: new Date(2027, 0, 1), to: new Date(2027, 0, 31) });
  });

  it("Custom Range is inclusive, may be open-ended, and ignores an empty custom range", () => {
    expect(inDateRange("10-10-2026", f("custom", "10-10-2026", "12-10-2026"), TODAY)).toBe(true);
    expect(inDateRange("12-10-2026", f("custom", "10-10-2026", "12-10-2026"), TODAY)).toBe(true);
    expect(inDateRange("13-10-2026", f("custom", "10-10-2026", "12-10-2026"), TODAY)).toBe(false);
    expect(inDateRange("01-01-2030", f("custom", "10-10-2026", ""), TODAY)).toBe(true);
    expect(inDateRange("01-01-2020", f("custom", "", "10-10-2026"), TODAY)).toBe(true);
    expect(inDateRange("01-01-2020", f("custom", "", ""), TODAY)).toBe(true);
  });

  it("a blank date never matches an active filter", () => {
    expect(inDateRange("", f("next7"), TODAY)).toBe(false);
    expect(inDateRange(undefined, f("custom", "10-10-2026", ""), TODAY)).toBe(false);
  });
});
