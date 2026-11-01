// Settings > Limits: how many runs at once, how many open applications per company, how long before
// applying to the same job again, and how soon to follow up. Spec: PRD T4 ("3 open applications per company,
// 90-day reapply rule"), ARCHITECTURE.md section 5.9 (Settings).
import type { SettingsResponse } from "@jobgoblin/schemas";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useUpdateSettings } from "@/api/settings";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

export function LimitsSection({ settings }: { settings: SettingsResponse }) {
  const { t } = useTranslation();
  const updateSettings = useUpdateSettings();
  const [concurrency, setConcurrency] = useState(String(settings.concurrency));
  const [maxOpenPerCompany, setMaxOpenPerCompany] = useState(String(settings.maxOpenPerCompany));
  const [reapplyDays, setReapplyDays] = useState(String(settings.reapplyDays));
  const [followUpDays, setFollowUpDays] = useState(String(settings.followUpDays));
  const [numberError, setNumberError] = useState<string | undefined>(undefined);
  const [hasSaved, setHasSaved] = useState(false);

  function save(event: FormEvent): void {
    event.preventDefault();
    const maxOpen = Number.parseInt(maxOpenPerCompany, 10);
    const reapply = Number.parseInt(reapplyDays, 10);
    const followUp = Number.parseInt(followUpDays, 10);
    const isValid = maxOpen >= 1 && reapply >= 0 && followUp >= 1;
    if (!isValid) {
      setNumberError(t("settings:limits.numberError"));
      return;
    }
    setNumberError(undefined);
    updateSettings.mutate(
      {
        concurrency: concurrency === "2" ? 2 : 1,
        maxOpenPerCompany: maxOpen,
        reapplyDays: reapply,
        followUpDays: followUp,
      },
      { onSuccess: () => setHasSaved(true) },
    );
  }

  // Typing in any box means the saved message no longer describes what is on screen.
  function updateField(setter: (value: string) => void, value: string): void {
    setHasSaved(false);
    setter(value);
  }

  return (
    <Card title={t("settings:limits.title")} description={t("settings:limits.description")}>
      {/* noValidate: the browser's own "Value must be greater than or equal to 1" bubble would hide the plain-words message. */}
      <form onSubmit={save} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("settings:limits.concurrency")} hint={t("settings:limits.concurrencyHint")}>
            {(control) => (
              <Select {...control} value={concurrency} onChange={(event) => updateField(setConcurrency, event.target.value)}>
                <option value="1">{t("settings:limits.one")}</option>
                <option value="2">{t("settings:limits.two")}</option>
              </Select>
            )}
          </Field>
          <Field label={t("settings:limits.maxOpen")} hint={t("settings:limits.maxOpenHint")} error={numberError}>
            {(control) => (
              <Input {...control} type="number" min={1} value={maxOpenPerCompany} onChange={(event) => updateField(setMaxOpenPerCompany, event.target.value)} />
            )}
          </Field>
          <Field label={t("settings:limits.reapply")} hint={t("settings:limits.reapplyHint")}>
            {(control) => (
              <Input {...control} type="number" min={0} value={reapplyDays} onChange={(event) => updateField(setReapplyDays, event.target.value)} />
            )}
          </Field>
          <Field label={t("settings:limits.followUp")} hint={t("settings:limits.followUpHint")}>
            {(control) => (
              <Input {...control} type="number" min={1} value={followUpDays} onChange={(event) => updateField(setFollowUpDays, event.target.value)} />
            )}
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={updateSettings.isPending}>
            {updateSettings.isPending ? t("common:actions.saving") : t("common:actions.save")}
          </Button>
          {hasSaved && (
            <p role="status" className="text-sm text-success">
              {t("settings:limits.saved")}
            </p>
          )}
        </div>
        <ErrorNotice error={updateSettings.error} />
      </form>
    </Card>
  );
}
