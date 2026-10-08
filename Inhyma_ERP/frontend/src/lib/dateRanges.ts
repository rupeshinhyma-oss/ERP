/**
 * Date-range filters for list pages (Import Purchase spec: "Today, Last 7 days, Next 7 days,
 * This Month, Next Month, Custom Range"). Dates in the ERP are DD-MM-YYYY strings.
 */

export type RangePreset = "" | "today" | "last7" | "next7" | "thisMonth" | "nextMonth" | "custom";

export interface DateFilter {
  preset: RangePreset;
  /** custom range bounds, DD-MM-YYYY; either may be blank */
  from: string;
  to: string;
}

export const EMPTY_DATE_FILTER: DateFilter = { preset: "", from: "", to: "" };

/** Options for the preset selector (the blank option means "no filter"). */
export const RANGE_PRESET_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: "", label: "All dates" },
  { value: "today", label: "Today" },
  { value: "last7", label: "Last 7 days" },
  { value: "next7", label: "Next 7 days" },
  { value: "thisMonth", label: "This Month" },
  { value: "nextMonth", label: "Next Month" },
  { value: "custom", label: "Custom Range" },
];

/** Parses DD-MM-YYYY (or YYYY-MM-DD) to a local date at midnight; null if blank or invalid. */
export function parseDMY(value: string | undefined | null): Date | null {
  if (!value) return null;
  const text = value.trim();
  let m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(text);
  let y: number, mo: number, d: number;
  if (m) {
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text))) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    return null;
  }
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** The inclusive [from, to] a preset covers on `today` ("last 7 days" and "next 7 days" count today as one of the 7). */
export function presetRange(preset: RangePreset, today: Date = new Date()): { from: Date; to: Date } | null {
  const t = startOfDay(today);
  switch (preset) {
    case "today":
      return { from: t, to: t };
    case "last7":
      return { from: addDays(t, -6), to: t };
    case "next7":
      return { from: t, to: addDays(t, 6) };
    case "thisMonth":
      return { from: new Date(t.getFullYear(), t.getMonth(), 1), to: new Date(t.getFullYear(), t.getMonth() + 1, 0) };
    case "nextMonth":
      return { from: new Date(t.getFullYear(), t.getMonth() + 1, 1), to: new Date(t.getFullYear(), t.getMonth() + 2, 0) };
    default:
      return null;
  }
}

/** True when `value` falls inside the filter. An inactive filter lets everything through; a blank date never matches an active one. */
export function inDateRange(value: string | undefined | null, filter: DateFilter, today: Date = new Date()): boolean {
  if (!filter.preset) return true;
  let range: { from: Date | null; to: Date | null } | null;
  if (filter.preset === "custom") {
    const from = parseDMY(filter.from);
    const to = parseDMY(filter.to);
    if (!from && !to) return true; // custom chosen but nothing entered yet
    range = { from, to };
  } else {
    range = presetRange(filter.preset, today);
  }
  if (!range) return true;
  const date = parseDMY(value);
  if (!date) return false;
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}
