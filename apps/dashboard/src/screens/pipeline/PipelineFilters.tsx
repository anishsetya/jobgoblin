// Search and filters above the pipeline: a search box (applied after a short pause in typing),
// one status, one fit band, and "overdue follow-ups only". Spec: PRD K1.
import { ApplicationStatus, Band } from "@jobgoblin/schemas";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { PipelineSearch } from "./pipelineSearch";

const TYPING_PAUSE_MS = 300;

type PipelineFiltersProps = {
  search: PipelineSearch;
  onSearchChange: (next: PipelineSearch) => void;
};

export function PipelineFilters({ search, onSearchChange }: PipelineFiltersProps) {
  const { t } = useTranslation();
  const [typedText, setTypedText] = useState(search.q ?? "");

  // Wait for a pause in typing before changing the address, so each key does not reload the list.
  useEffect(() => {
    const trimmedText = typedText.trim();
    if (trimmedText === (search.q ?? "")) return;
    const timer = window.setTimeout(() => {
      onSearchChange({ ...search, q: trimmedText === "" ? undefined : trimmedText });
    }, TYPING_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [typedText, search, onSearchChange]);

  return (
    <div className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field label={t("pipeline:filters.search")}>
        {(control) => <Input {...control} type="search" value={typedText} onChange={(event) => setTypedText(event.target.value)} />}
      </Field>

      <Field label={t("pipeline:filters.status")}>
        {(control) => (
          <Select
            {...control}
            value={search.status ?? ""}
            onChange={(event) => onSearchChange({ ...search, status: ApplicationStatus.safeParse(event.target.value).data })}
          >
            <option value="">{t("pipeline:filters.allStatuses")}</option>
            {ApplicationStatus.options.map((status) => (
              <option key={status} value={status}>
                {t(`common:status.${status}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label={t("pipeline:filters.band")}>
        {(control) => (
          <Select
            {...control}
            value={search.band ?? ""}
            onChange={(event) => onSearchChange({ ...search, band: Band.safeParse(event.target.value).data })}
          >
            <option value="">{t("pipeline:filters.allBands")}</option>
            {Band.options.map((band) => (
              <option key={band} value={band}>
                {t(`common:band.${band}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Checkbox
        label={t("pipeline:filters.overdueOnly")}
        checked={search.overdue === true}
        onChange={(event) => onSearchChange({ ...search, overdue: event.target.checked ? true : undefined })}
        className="pb-2"
      />
    </div>
  );
}
