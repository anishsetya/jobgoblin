// The Targets screen: what the person is looking for, and what to leave out or point out.
//   Roles to avoid  drop a job before Claude reads it (a word in the title)
//   Skip these      jobs Claude must skip whatever their score (hard skips)
//   Point out       risks Claude mentions but that never skip a job (flags)
// Where the person can work and their years of experience are answered once, on Form answers. This screen
// only shows what follows from them (the places searched, and the most years a job may ask for), and saves
// only its own fields on top of the latest saved targets, so it never undoes what Form answers saved.
// Spec: PRD P4 and F2. Used in the setup wizard (step 7) and in Profile's Targets tab.
import type { ProfileResponse, TargetsSection } from "@jobgoblin/schemas";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useSaveProfileSection } from "@/api/profile";
import { orderedPlaces, placeNameKey } from "@/lib/answersDraft";
import { ErrorNotice } from "./ErrorNotice";
import { LineListField } from "./LineListField";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

type TargetsDraft = Pick<TargetsSection, "roles" | "rolesToAvoid" | "hardSkips" | "flags">;

type TargetsEditorProps = {
  profileResponse: ProfileResponse;
  saveLabel: string;
  onSaved?: () => void;
};

export function TargetsEditor({ profileResponse, saveLabel, onSaved }: TargetsEditorProps) {
  const { t } = useTranslation();
  const saveSection = useSaveProfileSection();
  const [draft, setDraft] = useState<TargetsDraft>(() => {
    const { roles, rolesToAvoid, hardSkips, flags } = profileResponse.profile.targets;
    return { roles, rolesToAvoid, hardSkips, flags };
  });
  const [hasSaved, setHasSaved] = useState(false);

  function change(changes: Partial<TargetsDraft>): void {
    setHasSaved(false);
    setDraft((current) => ({ ...current, ...changes }));
  }

  function save(event: FormEvent): void {
    event.preventDefault();
    saveSection.mutate(
      { section: "targets", data: { ...profileResponse.profile.targets, ...draft } },
      {
        onSuccess: () => {
          setHasSaved(true);
          onSaved?.();
        },
      },
    );
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <Card title={t("profile:targets.lookingFor")}>
        <div className="space-y-5">
          <LineListField
            label={t("profile:targets.roles")}
            hint={t("profile:targets.rolesHint")}
            value={draft.roles}
            onChange={(roles) => change({ roles })}
          />
          <FromFormAnswers profileResponse={profileResponse} />
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

// What follows from Form answers, read-only: the places searched, the cities for on-site jobs, and the years limit.
function FromFormAnswers({ profileResponse }: { profileResponse: ProfileResponse }) {
  const { t } = useTranslation();
  const { regions, cities } = profileResponse.profile.targets;
  const { limit, experience } = profileResponse.yearsLimit;
  const places = orderedPlaces(regions).map((code) => t(placeNameKey(code), { defaultValue: code }));

  return (
    <div className="space-y-2">
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="font-medium">{t("profile:targets.where")}</dt>
        <dd>{places.length > 0 ? places.join(", ") : t("profile:targets.whereAnywhere")}</dd>
        {cities.length > 0 && (
          <>
            <dt className="font-medium">{t("profile:targets.cities")}</dt>
            <dd>{cities.join(", ")}</dd>
          </>
        )}
        <dt className="font-medium">{t("profile:targets.years")}</dt>
        <dd>
          {experience === null
            ? t("profile:targets.yearsDefault", { limit })
            : t("profile:targets.yearsFromExperience", { limit, experience })}
        </dd>
      </dl>
      <p className="text-xs text-muted">{t("profile:targets.fromAnswers")}</p>
    </div>
  );
}
