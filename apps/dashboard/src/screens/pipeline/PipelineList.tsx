// The list view of the pipeline: one row per application, as a table. Overdue follow-ups are in amber.
import type { PipelineRow } from "@jobgoblin/schemas";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BandBadge } from "@/components/BandBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { formatDay } from "@/lib/format";

export function PipelineList({ rows }: { rows: PipelineRow[] }) {
  const { t } = useTranslation();

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{t("pipeline:list.caption")}</caption>
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            <th scope="col" className="px-3 py-2 font-medium">
              {t("pipeline:list.role")}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t("pipeline:list.company")}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t("pipeline:list.status")}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t("pipeline:list.fit")}
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {t("pipeline:list.followUp")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-line last:border-b-0 hover:bg-surface-muted">
              <th scope="row" className="px-3 py-2 font-medium">
                <Link to="/apps/$id" params={{ id: row.id }} className="text-accent-text underline-offset-2 hover:underline">
                  {row.title}
                </Link>
              </th>
              <td className="px-3 py-2">{row.company}</td>
              <td className="px-3 py-2">
                <StatusBadge status={row.status} />
              </td>
              <td className="px-3 py-2">
                <span className="flex items-center gap-2">
                  {row.fitScore !== null && <span>{row.fitScore}</span>}
                  {row.band !== null && <BandBadge band={row.band} />}
                </span>
              </td>
              <td className="px-3 py-2">
                {row.followUpOn !== null &&
                  (row.overdue ? (
                    <Badge tone="amber">{t("pipeline:followUpOverdue", { date: formatDay(row.followUpOn) })}</Badge>
                  ) : (
                    formatDay(row.followUpOn)
                  ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
