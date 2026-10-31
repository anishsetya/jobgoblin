// Calendar helpers in the person's own time zone. The database keeps UTC moments; "today" and the
// follow-up day are the person's local calendar days, as the folder names and the tracker show them.
// Spec: ARCHITECTURE.md sections 5.7 (calendar days) and 8.6.
import { formatLocalDay } from "@jobgoblin/storage";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

// "2026-10-31": the person's calendar day.
export function localDay(now: Date): string {
  return formatLocalDay(now);
}

// The moment the person's current calendar day began, as an ISO timestamp ("done today" counts from here).
export function startOfLocalDay(now: Date): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

// The calendar day `days` after `now`, as "YYYY-MM-DD".
export function localDayAfter(now: Date, days: number): string {
  return formatLocalDay(new Date(now.getTime() + days * MILLISECONDS_PER_DAY));
}
