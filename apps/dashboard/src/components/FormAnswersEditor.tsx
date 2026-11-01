// The boxes of the Form answers screen: contact details, work authorization per region, work details, pay
// and equal-opportunity answers. These are the answers application forms ask for; Jobgoblin fills them in itself,
// and Claude never sees the personal ones. Used in the setup wizard and in Profile. Spec: PRD P3.
import type { ProfileResponse } from "@jobgoblin/schemas";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useSaveProfileSection, type SaveProfileSection } from "@/api/profile";
import { draftFromProfile, sectionsFromDraft, type AnswersDraft, type RegionDraft, type YesNoDraft } from "@/lib/answersDraft";
import { AnswerTextField } from "./AnswerTextField";
import { ErrorNotice } from "./ErrorNotice";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { YesNoField } from "./YesNoField";

type TextGroup = "contact" | "employment" | "compensation" | "eeo";
type TextFieldSpec = { group: TextGroup; field: string; isRequired: boolean; autoComplete?: string };

const CONTACT_FIELDS: TextFieldSpec[] = [
  { group: "contact", field: "fullName", isRequired: true, autoComplete: "name" },
  { group: "contact", field: "email", isRequired: true, autoComplete: "email" },
  { group: "contact", field: "phone", isRequired: true, autoComplete: "tel" },
  { group: "contact", field: "location", isRequired: true },
  { group: "contact", field: "linkedin", isRequired: false },
  { group: "contact", field: "github", isRequired: false },
  { group: "contact", field: "portfolio", isRequired: false },
];
const EMPLOYMENT_FIELDS: TextFieldSpec[] = [
  { group: "employment", field: "currentEmployer", isRequired: false },
  { group: "employment", field: "currentTitle", isRequired: false },
  { group: "employment", field: "noticePeriod", isRequired: true },
  { group: "employment", field: "earliestStartDate", isRequired: true },
  { group: "employment", field: "yearsExperience", isRequired: true },
];
const PAY_FIELDS: TextFieldSpec[] = [{ group: "compensation", field: "expectedBase", isRequired: true }];
const EEO_FIELDS: TextFieldSpec[] = [
  { group: "eeo", field: "gender", isRequired: true },
  { group: "eeo", field: "raceEthnicity", isRequired: true },
  { group: "eeo", field: "veteranStatus", isRequired: true },
  { group: "eeo", field: "disability", isRequired: true },
];

type FormAnswersEditorProps = {
  profileResponse: ProfileResponse;
  saveLabel: string;
  onSaved?: () => void;
};

export function FormAnswersEditor({ profileResponse, saveLabel, onSaved }: FormAnswersEditorProps) {
  const { t } = useTranslation();
  const saveSection = useSaveProfileSection();
  const [draft, setDraft] = useState<AnswersDraft>(() => draftFromProfile(profileResponse.profile));
  const [saveError, setSaveError] = useState<unknown>(null);
  const [hasSaved, setHasSaved] = useState(false);

  function setText(group: TextGroup, field: string, value: string): void {
    setHasSaved(false);
    setDraft((current) => ({ ...current, [group]: { ...current[group], [field]: value } }));
  }

  function setRegionAnswer(code: string, question: keyof RegionDraft, value: YesNoDraft): void {
    setHasSaved(false);
    setDraft((current) => {
      const region = current.regions[code];
      if (region === undefined) return current;
      return { ...current, regions: { ...current.regions, [code]: { ...region, [question]: value } } };
    });
  }

  // Saves the sections whose answers differ from what is stored, one request each.
  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSaveError(null);
    const sections = sectionsFromDraft(draft, profileResponse.profile);
    const allSections: SaveProfileSection[] = [
      { section: "contact", data: sections.contact },
      { section: "workAuthorization", data: sections.workAuthorization },
      { section: "employment", data: sections.employment },
      { section: "compensation", data: sections.compensation },
      { section: "eeo", data: sections.eeo },
    ];
    const changedSections = allSections.filter(
      (item) => JSON.stringify(item.data) !== JSON.stringify(profileResponse.profile[item.section]),
    );

    try {
      for (const item of changedSections) {
        await saveSection.mutateAsync(item);
      }
      setHasSaved(true);
      onSaved?.();
    } catch (error) {
      setSaveError(error);
    }
  }

  function renderTextFields(specs: TextFieldSpec[]) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {specs.map((spec) => (
          <AnswerTextField
            key={`${spec.group}.${spec.field}`}
            label={t(`profile:answers.fields.${spec.group}.${spec.field}`)}
            value={(draft[spec.group] as Record<string, string>)[spec.field] ?? ""}
            isRequired={spec.isRequired}
            autoComplete={spec.autoComplete}
            onChange={(value) => setText(spec.group, spec.field, value)}
          />
        ))}
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void save(event)} className="space-y-6">
      <p className="text-sm text-muted">{t("profile:answers.privacy")}</p>

      {profileResponse.missing.length > 0 && (
        <p className="rounded-md border border-flag-line bg-flag-soft p-3 text-sm text-flag">
          {t("profile:answers.missingSummary", {
            count: profileResponse.missing.length,
            labels: profileResponse.missing.map((missing) => missing.label).join(", "),
          })}
        </p>
      )}

      <Card title={t("profile:answers.sections.contact")}>{renderTextFields(CONTACT_FIELDS)}</Card>

      <Card title={t("profile:answers.sections.workAuthorization")} description={t("profile:answers.workAuthorizationHint")}>
        <div className="space-y-6">
          {Object.entries(draft.regions).map(([code, region]) => (
            <fieldset key={code} className="space-y-3">
              <legend className="mb-2 text-sm font-semibold">{t(`common:region.${code}`, { defaultValue: code })}</legend>
              <div className="grid gap-4 sm:grid-cols-3">
                <YesNoField
                  label={t("profile:answers.fields.workAuthorization.authorized")}
                  value={region.authorized}
                  onChange={(value) => setRegionAnswer(code, "authorized", value)}
                />
                <YesNoField
                  label={t("profile:answers.fields.workAuthorization.requiresSponsorship")}
                  value={region.requiresSponsorship}
                  onChange={(value) => setRegionAnswer(code, "requiresSponsorship", value)}
                />
                <YesNoField
                  label={t("profile:answers.fields.workAuthorization.willingToRelocate")}
                  value={region.willingToRelocate}
                  onChange={(value) => setRegionAnswer(code, "willingToRelocate", value)}
                />
              </div>
            </fieldset>
          ))}
        </div>
      </Card>

      <Card title={t("profile:answers.sections.employment")}>{renderTextFields(EMPLOYMENT_FIELDS)}</Card>
      <Card title={t("profile:answers.sections.pay")}>{renderTextFields(PAY_FIELDS)}</Card>
      <Card title={t("profile:answers.sections.eeo")} description={t("profile:answers.eeoHint")}>
        {renderTextFields(EEO_FIELDS)}
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="accent" disabled={saveSection.isPending}>
          {saveSection.isPending ? t("common:actions.saving") : saveLabel}
        </Button>
        {hasSaved && (
          <p role="status" className="text-sm text-success">
            {t("profile:answers.saved")}
          </p>
        )}
      </div>
      <ErrorNotice error={saveError} />
    </form>
  );
}
