// The Targets screen: what the person is looking for, and what to leave out or point out.
//   Roles to avoid  drop a job before Claude reads it (a word in the title)
//   Skip these      jobs Claude must skip whatever their score (hard skips)
//   Point out       risks Claude mentions but that never skip a job (flags)
// Spec: PRD P4 and F2. Used in the setup wizard (step 7) and in Profile's Targets tab.
import { Region, type ProfileResponse, type TargetsSection } from "@jobgoblin/schemas";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useSaveProfileSection } from "@/api/profile";
import { ErrorNotice } from "./ErrorNotice";
import { LineListField } from "./LineListField";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Checkbox } from "./ui/Checkbox";
import { Field } from "./ui/Field";
import { Input } from "./ui/Input";

type TargetsEditorProps = {
  profileResponse: ProfileResponse;
  saveLabel: string;
  onSaved?: () => void;
};

export function TargetsEditor({ profileResponse, saveLabel, onSaved }: TargetsEditorProps) {
  const { t } = useTranslation();
  const saveSection = useSaveProfileSection();
  const [draft, setDraft] = useState<TargetsSection>(() => ({ ...profileResponse.profile.targets }));
  const [maxYears, setMaxYears] = useState(() => String(profileResponse.profile.targets.maxYearsRequired));
  const [yearsError, setYearsError] = useState<string | undefined>(undefined);
  const [hasSaved, setHasSaved] = useState(false);

  function change(changes: Partial<TargetsSection>): void {
    setHasSaved(false);
    setDraft((current) => ({ ...current, ...changes }));
  }

  function toggleRegion(code: string, isChecked: boolean): void {
    const others = draft.regions.filter((region) => region !== code);
    change({ regions: isChecked ? [...others, code] : others });
  }

  function save(event: FormEvent): void {
    event.preventDefault();
    const years = Number.parseInt(maxYears, 10);
    if (Number.isNaN(years) || years < 0) {
      setYearsError(t("profile:targets.yearsError"));
      return;
    }
    setYearsError(undefined);
    saveSection.mutate(
      { section: "targets", data: { ...draft, maxYearsRequired: years } },
      {
        onSuccess: () => {
          setHasSaved(true);
          onSaved?.();
        },
      },
    );
  }

  return (
    // noValidate: the browser's own bubble for a number below its minimum would hide the plain-words message.
    <form onSubmit={save} noValidate className="space-y-6">
      <Card title={t("profile:targets.lookingFor")}>
        <div className="space-y-5">
          <LineListField
            label={t("profile:targets.roles")}
            hint={t("profile:targets.rolesHint")}
            value={draft.roles}
            onChange={(roles) => change({ roles })}
          />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("profile:targets.regions")}</legend>
            {Region.options.map((code) => (
              <Checkbox
                key={code}
                label={t(`common:region.${code}`)}
                checked={draft.regions.includes(code)}
                onChange={(event) => toggleRegion(code, event.target.checked)}
              />
            ))}
          </fieldset>
          <Field label={t("profile:targets.maxYears")} hint={t("profile:targets.maxYearsHint")} error={yearsError} className="max-w-xs">
            {(control) => (
              <Input
                {...control}
                type="number"
                min={0}
                value={maxYears}
                onChange={(event) => {
                  setHasSaved(false);
                  setMaxYears(event.target.value);
                }}
              />
            )}
          </Field>
        </div>
      </Card>

      <Card title={t("profile:targets.leaveOut")}>
        <div className="space-y-5">
          <LineListField
            label={t("profile:targets.rolesToAvoid")}
            hint={t("profile:targets.rolesToAvoidHint")}
            value={draft.rolesToAvoid}
            onChange={(rolesToAvoid) => change({ rolesToAvoid })}
          />
          <LineListField
            label={t("profile:targets.hardSkips")}
            hint={t("profile:targets.hardSkipsHint")}
            value={draft.hardSkips}
            onChange={(hardSkips) => change({ hardSkips })}
          />
          <LineListField
            label={t("profile:targets.flags")}
            hint={t("profile:targets.flagsHint")}
            value={draft.flags}
            onChange={(flags) => change({ flags })}
          />
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="accent" disabled={saveSection.isPending}>
          {saveSection.isPending ? t("common:actions.saving") : saveLabel}
        </Button>
        {hasSaved && (
          <p role="status" className="text-sm text-success">
            {t("profile:targets.saved")}
          </p>
        )}
      </div>
      <ErrorNotice error={saveSection.error} />
    </form>
  );
}
