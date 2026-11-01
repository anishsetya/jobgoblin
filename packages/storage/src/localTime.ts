// Dates as the person reads them: their own calendar day and clock, not UTC.
// Folder names, backup names and the tracker show these; the database keeps UTC timestamps.
// The functions take a Date, so callers pass the injected clock (`now()`) and tests stay deterministic.

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

// "2026-10-31", the person's local calendar day.
export function formatLocalDay(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  return `${year}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
}

// "2026-10-31 14:05" (or "2026-10-31 14-05" for file names, where ":" is not allowed on Windows).
export function formatLocalMinute(date: Date, hourMinuteSeparator: string): string {
  return `${formatLocalDay(date)} ${twoDigits(date.getHours())}${hourMinuteSeparator}${twoDigits(date.getMinutes())}`;
}
