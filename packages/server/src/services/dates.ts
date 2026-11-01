// Calendar helpers in the person's own time zone. The database keeps UTC moments; "today" and the
// follow-up day are the person's local calendar days, as the folder names and the tracker show them.
// (A plain "today" is storage's formatLocalDay(now); only the two helpers below need more than that.)
// Spec: ARCHITECTURE.md sections 5.7 (calendar days) and 8.6.
import { formatLocalDay } from "@jobgoblin/storage";

// The moment the person's current calendar day began, as an ISO timestamp ("done today" counts from here).
export function startOfLocalDay(now: Date): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

// The calendar day `days` after `now`, as "YYYY-MM-DD".
// Calendar arithmetic, not "add 24 hours": on a day the clocks change a day is 23 or 25 hours long, and
// adding milliseconds could land on the wrong date.
export function localDayAfter(now: Date, days: number): string {
  const later = new Date(now);
  later.setDate(later.getDate() + days);
  return formatLocalDay(later);
}
