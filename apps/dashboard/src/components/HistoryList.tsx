// The change log of one application, newest first, each row in plain words: "You approved this application".
// Rows are only ever added by the server (the database blocks edits), so this is a faithful record.
import type { HistoryEvent, HistoryEventType } from "@jobgoblin/schemas";
import { useTranslation } from "react-i18next";
import { formatMoment } from "@/lib/format";

// For these events the detail text is something the person or Claude wrote, so it is worth showing.
const EVENTS_WITH_SHOWN_DETAIL: readonly HistoryEventType[] = ["note", "question-asked", "question-answered"];

export function HistoryList({ events }: { events: HistoryEvent[] }) {
  const { t } = useTranslation();
  const newestFirst = [...events].sort((a, b) => b.ts.localeCompare(a.ts));

  function statusLabel(status: string | null): string {
    return status === null ? "" : t(`common:status.${status}`, { defaultValue: status });
  }

  return (
    <ol className="space-y-3">
      {newestFirst.map((event) => (
        <li key={event.id} className="text-sm">
          <p>
            <span className="font-medium">{t(`common:actor.${event.actor}`)}</span>{" "}
            {t(`application:history.${event.type}`, { from: statusLabel(event.from), to: statusLabel(event.to) })}
          </p>
          {event.detail !== null && EVENTS_WITH_SHOWN_DETAIL.includes(event.type) && (
            <p className="text-muted">{event.detail}</p>
          )}
          <p className="text-xs text-muted">{formatMoment(event.ts)}</p>
        </li>
      ))}
    </ol>
  );
}
