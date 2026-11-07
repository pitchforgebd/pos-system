// Business dates. A business date is a calendar day (YYYY-MM-DD) in the shop's time zone, not in the
// server's and not in UTC. This file has no dependencies, so client components can import it too.

export const BUSINESS_TIME_ZONE = "Asia/Dhaka";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    formatters.set(timeZone, found);
  }
  return found;
}

function pad(value: number, length = 2) {
  return String(value).padStart(length, "0");
}

/** The calendar day at `now` in the business time zone (Asia/Dhaka unless another zone is given). */
export function businessDate(now: Date = new Date(), timeZone: string = BUSINESS_TIME_ZONE): string {
  const parts = formatter(timeZone).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** True for a real calendar day written as YYYY-MM-DD (rejects 2026-02-31). */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function assertIsoDate(value: string) {
  if (!isIsoDate(value)) {
    throw new RangeError(`Not a calendar date (YYYY-MM-DD): ${value}`);
  }
}

function toUtcDate(value: string) {
  assertIsoDate(value);
  return new Date(`${value}T00:00:00.000Z`);
}

/** The stored day of a DATE column. Prisma returns those as midnight UTC, so read the UTC fields. */
export function dateOnly(value: Date): string {
  return `${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

/** `date` plus `days` calendar days (negative goes back). */
export function addDays(date: string, days: number): string {
  const result = toUtcDate(date);
  result.setUTCDate(result.getUTCDate() + days);
  return dateOnly(result);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcDate(to).getTime() - toUtcDate(from).getTime()) / 86_400_000);
}

export type FiscalYear = {
  startYear: number;
  endYear: number;
  /** Two digits of the start year and two of the end year, as in document numbers: 2627. */
  label: string;
  start: string;
  end: string;
};

/** The fiscal year that contains `date`. July to June by default (decision D9); startMonth 1 is the calendar year. */
export function fiscalYear(date: string, startMonth = 7): FiscalYear {
  assertIsoDate(date);
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new RangeError(`Not a month (1-12): ${startMonth}`);
  }
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const startYear = month >= startMonth ? year : year - 1;
  const endYear = startMonth === 1 ? startYear : startYear + 1;
  const start = `${pad(startYear, 4)}-${pad(startMonth)}-01`;
  const nextStart = `${pad(startYear + 1, 4)}-${pad(startMonth)}-01`;
  return {
    startYear,
    endYear,
    label: `${pad(startYear % 100)}${pad(endYear % 100)}`,
    start,
    end: addDays(nextStart, -1),
  };
}
