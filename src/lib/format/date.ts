import { isIsoDate } from "@/core/time/business-date";

export { isIsoDate };

/**
 * The one way to turn a business date (YYYY-MM-DD) into the Date stored in DATE columns:
 * midnight UTC, so it never shifts with the server time zone. Throws on anything else.
 */
export function occurredDate(value: string) {
  if (!isIsoDate(value)) {
    throw new RangeError(`Not a calendar date (YYYY-MM-DD): ${value}`);
  }
  return new Date(`${value}T00:00:00.000Z`);
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function weekdayIndex(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function toIsoDate(year: number, month: number, day: number) {
  const monthText = String(month).padStart(2, "0");
  const dayText = String(day).padStart(2, "0");
  return `${year}-${monthText}-${dayText}`;
}

export function parseIsoDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return { year, month, day };
}

export function formatDisplayDate(isoDate: string) {
  const { year, month, day } = parseIsoDate(isoDate);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatMonthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export function shiftMonth(year: number, month: number, delta: number) {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}
