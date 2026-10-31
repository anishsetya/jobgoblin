// One application as a card on the board: the role, the company, its status and fit, and the follow-up day.
// An overdue follow-up is the one thing shown in amber (PRD K2).
import type { PipelineRow } from "@jobgoblin/schemas";
import { Link } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BandBadge } from "@/components/BandBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { formatDay } from "@/lib/format";

export function PipelineCard({ row }: { row: PipelineRow }) {
  const { t } = useTranslation();

  return (
    <li data-testid="pipeline-card" className="rounded-lg border border-line bg-surface p-3 hover:bg-surface-muted">
      <Link to="/apps/$id" params={{ id: row.id }} className="block space-y-2">
        <span className="block text-sm font-semibold">{row.title}</span>
        <span className="block text-sm text-muted">{row.company}</span>
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={row.status} />
          {row.band !== null && <BandBadge band={row.band} />}
          {row.fitScore !== null && <span className="text-xs text-muted">{t("pipeline:fit", { score: row.fitScore })}</span>}
        </span>
        {/* This badge may wrap onto two lines, so a long date is not cut off in the narrow column. */}
        {row.followUpOn !== null && (
          <Badge tone={row.overdue ? "amber" : "neutral"} className="whitespace-normal">
            <Clock aria-hidden="true" className="size-3" />
            {row.overdue
              ? t("pipeline:followUpOverdue", { date: formatDay(row.followUpOn) })
              : t("pipeline:followUp", { date: formatDay(row.followUpOn) })}
          </Badge>
        )}
      </Link>
    </li>
  );
}
