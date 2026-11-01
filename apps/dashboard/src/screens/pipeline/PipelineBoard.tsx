// The board: one column per status group (To review, Ready to apply, Applied, Interviewing, Offer, Closed),
// left to right, from STATUS_GROUPS. Every application is in exactly one column. Spec: PRD K1.
import { STATUS_GROUPS, type PipelineRow } from "@jobgoblin/schemas";
import { useTranslation } from "react-i18next";
import { PipelineCard } from "./PipelineCard";

export function PipelineBoard({ rows }: { rows: PipelineRow[] }) {
  const { t } = useTranslation();

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {STATUS_GROUPS.map((group) => {
        const rowsInGroup = rows.filter((row) => group.statuses.includes(row.status));
        const headingId = `pipeline-group-${group.name.replace(/\s+/g, "-")}`;
        return (
          <section key={group.name} aria-labelledby={headingId} className="w-64 shrink-0 space-y-3">
            <h2 id={headingId} className="flex items-center justify-between text-sm font-semibold">
              {t(`pipeline:groups.${group.name}`, { defaultValue: group.name })}
              <span className="rounded-full bg-surface-muted px-2 text-xs font-normal text-muted">{rowsInGroup.length}</span>
            </h2>
            {rowsInGroup.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line p-3 text-xs text-muted">{t("pipeline:emptyColumn")}</p>
            ) : (
              <ul className="space-y-2">
                {rowsInGroup.map((row) => (
                  <PipelineCard key={row.id} row={row} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
