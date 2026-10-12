import { START_DATE_TIMEZONE } from "./config.ts";

export function resolveStartDate(now: Date, timeZone: string = START_DATE_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error(`Could not resolve today's date in ${timeZone}.`);
  }
  return `${year}-${month}-${day}`;
}
