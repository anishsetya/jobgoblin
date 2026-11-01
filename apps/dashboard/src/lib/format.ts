// Turns dates, times and sizes from the server into short text for the screen.
// The browser's own locale is used on purpose: the person sees dates the way their computer writes them.

const DAY_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const MOMENT_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const MONTH_FORMAT = new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" });

const BYTES_PER_KILOBYTE = 1024;

// A calendar day such as "2026-11-07" (follow-up dates). It is built from its parts rather than
// parsed as a moment, so a person west of Greenwich does not see the day before.
export function formatDay(isoDay: string): string {
  const [year, month, day] = isoDay.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return isoDay;
  return DAY_FORMAT.format(new Date(year, month - 1, day));
}

// A moment such as "2026-11-07T14:30:00.000Z", shown in the person's time zone.
export function formatMoment(isoMoment: string): string {
  const date = new Date(isoMoment);
  if (Number.isNaN(date.getTime())) return isoMoment;
  return MOMENT_FORMAT.format(date);
}

// Your story dates are "YYYY-MM", "YYYY" or "Present" (see story.ts). Only the month form needs work.
export function formatStoryDate(storyDate: string): string {
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(storyDate);
  if (monthMatch === null) return storyDate;
  const [, year, month] = monthMatch;
  return MONTH_FORMAT.format(new Date(Number(year), Number(month) - 1, 1));
}

// "Jun 2024 - Present". Either end may be missing.
export function formatStoryDateRange(startDate: string | undefined, endDate: string | undefined): string {
  const start = startDate === undefined ? "" : formatStoryDate(startDate);
  const end = endDate === undefined ? "" : formatStoryDate(endDate);
  if (start !== "" && end !== "") return `${start} - ${end}`;
  return start !== "" ? start : end;
}

export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < BYTES_PER_KILOBYTE) return `${sizeBytes} B`;
  const kilobytes = sizeBytes / BYTES_PER_KILOBYTE;
  if (kilobytes < BYTES_PER_KILOBYTE) return `${kilobytes.toFixed(0)} KB`;
  return `${(kilobytes / BYTES_PER_KILOBYTE).toFixed(1)} MB`;
}
