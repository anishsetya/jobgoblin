// Pipeline: every application, as a board by status group or as a list, with search and filters.
// Spec: PRD "Screens: Pipeline" and K1/K2, ARCHITECTURE.md section 12 (/pipeline).
import { Link } from "@tanstack/react-router";
import { LayoutGrid, List } from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePipeline } from "@/api/pipeline";
import { EmptyState } from "@/components/EmptyState";
import { ErrorNotice } from "@/components/ErrorNotice";
import { LoadingNote } from "@/components/LoadingNote";
import { Button } from "@/components/ui/Button";
import { usePageTitle } from "@/lib/pageTitle";
import { PipelineBoard } from "./pipeline/PipelineBoard";
import { PipelineFilters } from "./pipeline/PipelineFilters";
import { PipelineList } from "./pipeline/PipelineList";
import { hasFilters, toPipelineQuery, type PipelineSearch, type PipelineView } from "./pipeline/pipelineSearch";

type PipelineScreenProps = {
  search: PipelineSearch;
  onSearchChange: (next: PipelineSearch) => void;
};

export function PipelineScreen({ search, onSearchChange }: PipelineScreenProps) {
  const { t } = useTranslation();
  usePageTitle(t("pipeline:title"));
  const pipeline = usePipeline(toPipelineQuery(search));

  function renderViewButton(view: PipelineView, label: string) {
    const isSelected = (search.view ?? "board") === view;
    const Icon = view === "board" ? LayoutGrid : List;
    return (
      <Button
        size="small"
        variant={isSelected ? "secondary" : "ghost"}
        aria-pressed={isSelected}
        onClick={() => onSearchChange({ ...search, view: view === "board" ? undefined : view })}
      >
        <Icon aria-hidden="true" className="size-4" />
        {label}
      </Button>
    );
  }

  function renderRows() {
    if (pipeline.isPending) return <LoadingNote />;
    if (pipeline.isError) return <ErrorNotice error={pipeline.error} onRetry={() => void pipeline.refetch()} />;

    if (pipeline.data.length === 0 && !hasFilters(search)) {
      return (
        <EmptyState
          title={t("pipeline:empty.title")}
          description={t("pipeline:empty.description")}
          action={
            <Button asChild>
              <Link to="/today">{t("pipeline:empty.action")}</Link>
            </Button>
          }
        />
      );
    }
    if (pipeline.data.length === 0) {
      return <EmptyState title={t("pipeline:noMatches.title")} description={t("pipeline:noMatches.description")} />;
    }
    return search.view === "list" ? <PipelineList rows={pipeline.data} /> : <PipelineBoard rows={pipeline.data} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("pipeline:title")}</h1>
        <div role="group" aria-label={t("pipeline:view.label")} className="flex gap-1">
          {renderViewButton("board", t("pipeline:view.board"))}
          {renderViewButton("list", t("pipeline:view.list"))}
        </div>
      </div>

      <PipelineFilters search={search} onSearchChange={onSearchChange} />
      {renderRows()}
    </div>
  );
}
