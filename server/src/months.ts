/** Days ("YYYY-MM-DD") and months ("YYYY-MM") as text, and the sums on them. */
import { DomainError, localTime } from "warren/server";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^(\d{4})-(\d{2})(?:-\d{2})?$/;

const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function isDay(value: unknown): value is string {
  return typeof value === "string" && DAY.test(value) && !Number.isNaN(utc(value).getTime()) && iso(utc(value)) === value;
}

/** The month of a day or month string: "2026-06-10" -> "2026-06". */
export function monthOf(value: string): string {
  return value.slice(0, 7);
}

export function isMonth(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = MONTH.exec(value);
  return m !== null && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

/** "YYYY-MM" (or "YYYY-MM-DD") to a month; `fallback` when missing or invalid. */
export function parseMonth(value: string | null | undefined, fallback: string): string {
  return isMonth(value) ? monthOf(value) : monthOf(fallback);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + n;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Every month from `first` to `last` inclusive. */
export function monthRange(first: string, last: string): string[] {
  const out: string[] = [];
  for (let m = monthOf(first); m <= monthOf(last); m = addMonths(m, 1)) out.push(m);
  return out;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(day: string, n: number): string {
  const d = utc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** `day` moved by whole months, keeping the day of the month or clamping to the month's last day. */
export function addMonthsToDay(day: string, n: number): string {
  const month = addMonths(monthOf(day), n);
  const dom = Math.min(Number(day.slice(8, 10)), daysInMonth(month));
  return `${month}-${String(dom).padStart(2, "0")}`;
}

/** Today in the household's timezone. */
export function today(timezone: string, now = new Date()): string {
  return localTime(now, timezone).date;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "May 26", for chart axes. */
export function monthLabel(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(2, 4)}`;
}

/** "May 2026" */
export function monthName(month: string): string {
  return `${LONG_MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

export function requireDay(value: unknown, field = "date"): string {
  if (!isDay(value)) throw new DomainError(`${field} must be a date like 2026-05-20 (YYYY-MM-DD); got ${JSON.stringify(value)}.`);
  return value;
}

export function requireMonth(value: unknown, field = "month"): string {
  if (!isMonth(value)) throw new DomainError(`${field} must be a month like 2026-05 (YYYY-MM); got ${JSON.stringify(value)}.`);
  return monthOf(value);
}
