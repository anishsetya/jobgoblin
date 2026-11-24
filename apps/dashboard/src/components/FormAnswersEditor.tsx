// The boxes of the Form answers screen: contact details, where you can work, work authorization for each country
// chosen, work details, pay and equal-opportunity answers. These are the answers application forms ask for;
// Jobgoblin fills them in itself, and Claude never sees the personal ones. Used in the setup wizard and in Profile.
// "Where you can work" comes before the questions it decides: each country chosen gets its questions, and Remote
// jobs gets those of the country where the person lives. It is saved in the targets, where the job filter reads it.
// What the server says about one box is shown under that box: a refusal (a banned word, a value far too long)
// until the box is changed, and a warning about a saved value (an email address with no "@") while the box
// still holds it.
// Spec: PRD P3 and P4.
import type { ProfileResponse, ProfileWarning } from "@jobgoblin/schemas";
import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ApiProblem } from "@/api/client";
import { useSaveProfileSection, type SaveProfileSection } from "@/api/profile";
import {
  askedCountries,
  draftFromProfile,
  orderedPlaces,
  PLACE_CHOICES,
  placeNameKey,
  sectionsFromDraft,
  withCities,
  type AnswersDraft,
  type RegionDraft,
  type YesNoDraft,
} from "@/lib/answersDraft";
import { AnswerTextField } from "./AnswerTextField";
import { ErrorNotice } from "./ErrorNotice";
import { LineListField } from "./LineListField";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Checkbox } from "./ui/Checkbox";
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

// "contact.email": how the server names a box (ApiError.field, ProfileWarning).
function fieldKey(spec: TextFieldSpec): string {
  return `${spec.group}.${spec.field}`;
}

function textOf(draft: AnswersDraft, spec: TextFieldSpec): string {
  return (draft[spec.group] as Record<string, string>)[spec.field] ?? "";
}

function savedValueOf(response: ProfileResponse, warning: ProfileWarning): unknown {
  return (response.profile[warning.section] as Record<string, unknown>)[warning.key];
}

// The warnings about values this save changed. The others were already shown before it.
function warningsAboutChanges(before: ProfileResponse, after: ProfileResponse): ProfileWarning[] {
  return after.warnings.filter((warning) => savedValueOf(before, warning) !== savedValueOf(after, warning));
}

type FormAnswersEditorProps = {
  profileResponse: ProfileResponse;
  saveLabel: string;
  onSaved?: () => void;
};

export function FormAnswersEditor({ profileResponse, saveLabel, onSaved }: FormAnswersEditorProps) {
  const { t } = useTranslation();
  const saveSection = useSaveProfileSection();
  const [draft, setDraft] = useState<AnswersDraft>(() => draftFromProfile(profileResponse));
  const [saveError, setSaveError] = useState<unknown>(null);
  const [hasSaved, setHasSaved] = useState(false);
  const [newlyAsked, setNewlyAsked] = useState<string[]>([]);
  const [newWarnings, setNewWarnings] = useState<ProfileWarning[]>([]);
  // The saved answers as the boxes would hold them, to tell whether a box still holds what was saved.
  const savedDraft = useMemo(() => draftFromProfile(profileResponse), [profileResponse]);

  const { homeRegion } = profileResponse;
  const shownCountries = askedCountries(draft.places.regions, homeRegion);
  const homeUnknownForRemote = draft.places.regions.includes("REMOTE") && homeRegion === null;
  const countryName = (code: string): string => t(`common:region.${code}`, { defaultValue: code });

  function edited(): void {
    setHasSaved(false);
    setNewlyAsked([]);
    setNewWarnings([]);
  }

  function isRefused(key: string): boolean {
    return saveError instanceof ApiProblem && saveError.field === key;
  }

  function setText(group: TextGroup, field: string, value: string): void {
    edited();
    // Changing the box a refusal was about clears it; the next save checks the new value.
    if (isRefused(`${group}.${field}`)) setSaveError(null);
    setDraft((current) => ({ ...current, [group]: { ...current[group], [field]: value } }));
  }

  function togglePlace(code: string, isChecked: boolean): void {
    edited();
    setDraft((current) => {
      const others = current.places.regions.filter((region) => region !== code);
      const regions = orderedPlaces(isChecked ? [...others, code] : others);
      return { ...current, places: { ...current.places, regions } };
    });
  }

  function setCities(cities: string[]): void {
    edited();
    setDraft((current) => withCities(current, cities, homeRegion));
  }

  function setRegionAnswer(code: string, question: keyof RegionDraft, value: YesNoDraft): void {
    edited();
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
    setHasSaved(false);
    const saved = profileResponse.profile;
    const sections = sectionsFromDraft(draft, saved);
    const allSections: SaveProfileSection[] = [
      { section: "contact", data: sections.contact },
      { section: "targets", data: sections.targets },
      { section: "workAuthorization", data: sections.workAuthorization },
      { section: "employment", data: sections.employment },
      { section: "compensation", data: sections.compensation },
      { section: "eeo", data: sections.eeo },
    ];
    const changedSections = allSections.filter((item) => JSON.stringify(item.data) !== JSON.stringify(saved[item.section]));

    try {
      let latest = profileResponse;
      for (const item of changedSections) {
        latest = await saveSection.mutateAsync(item);
      }
      setHasSaved(true);
      // A new "Where you live" can bring questions of its own (Remote jobs asks those of the country you live
      // in). They are on the screen now, so the wizard waits for them instead of moving on.
      const added = askedCountries(draft.places.regions, latest.homeRegion).filter((code) => !shownCountries.includes(code));
      if (added.length > 0) {
        setNewlyAsked(added);
        return;
      }
      // A value just saved that looks wrong is pointed out, and the wizard waits so the person sees it. Saving
      // again without changing it goes on: it is the person's call.
      const warned = warningsAboutChanges(profileResponse, latest);
      if (warned.length > 0) {
        setNewWarnings(warned);
        return;
      }
      onSaved?.();
    } catch (error) {
      setSaveError(error);
    }
  }

  // A warning is about the saved value, so it shows only while the box still holds that value.
  function warningFor(spec: TextFieldSpec, value: string): string | undefined {
    if (value.trim() !== textOf(savedDraft, spec)) return undefined;
    return profileResponse.warnings.find((warning) => warning.section === spec.group && warning.key === spec.field)?.message;
  }

  function refusalFor(spec: TextFieldSpec): string | undefined {
    return saveError instanceof ApiProblem && saveError.field === fieldKey(spec) ? saveError.message : undefined;
  }

  function savedMessage(): string {
    if (newlyAsked.length > 0) {
      return t("profile:answers.places.newQuestions", { countries: newlyAsked.map(countryName).join(", ") });
    }
    if (newWarnings.length > 0) {
      const labels = newWarnings.map((warning) => t(`profile:answers.fields.${warning.section}.${warning.key}`)).join(", ");
      const key = onSaved === undefined ? "profile:answers.savedCheck" : "profile:answers.savedCheckThenGoOn";
      return t(key, { count: newWarnings.length, labels });
    }
    return t("profile:answers.saved");
  }

  function renderTextFields(specs: TextFieldSpec[]) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {specs.map((spec) => {
          const value = textOf(draft, spec);
          return (
            <AnswerTextField
              key={fieldKey(spec)}
              label={t(`profile:answers.fields.${spec.group}.${spec.field}`)}
              value={value}
              isRequired={spec.isRequired}
              autoComplete={spec.autoComplete}
              error={refusalFor(spec)}
              warning={warningFor(spec, value)}
              onChange={(next) => setText(spec.group, spec.field, next)}
            />
          );
        })}
      </div>
    );
  }

  function renderCountryQuestions(code: string) {
    const region = draft.regions[code];
    if (region === undefined) return null;
    const legend = code === homeRegion ? t("profile:answers.places.whereYouLive", { country: countryName(code) }) : countryName(code);
    return (
      <fieldset key={code} className="space-y-3">
        <legend className="mb-2 text-sm font-semibold">{legend}</legend>
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

      <Card title={t("profile:answers.sections.places")} description={t("profile:answers.places.hint")}>
        <div className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("profile:answers.places.legend")}</legend>
            {PLACE_CHOICES.map((code) => (
              <Checkbox
                key={code}
                label={t(placeNameKey(code))}
                checked={draft.places.regions.includes(code)}
                onChange={(event) => togglePlace(code, event.target.checked)}
              />
            ))}
          </fieldset>
          <LineListField
            label={t("profile:answers.places.cities")}
            hint={t("profile:answers.places.citiesHint")}
            value={draft.places.cities}
            onChange={setCities}
            rows={3}
          />
        </div>
      </Card>

      <Card title={t("profile:answers.sections.workAuthorization")} description={t("profile:answers.workAuthorizationHint")}>
        <div className="space-y-6">
          {homeUnknownForRemote && <p className="text-sm text-muted">{t("profile:answers.places.homeUnknown")}</p>}
          {shownCountries.length === 0 && !homeUnknownForRemote && (
            <p className="text-sm text-muted">{t("profile:answers.places.noQuestions")}</p>
          )}
          {shownCountries.map(renderCountryQuestions)}
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
          <p role="status" className={newlyAsked.length > 0 || newWarnings.length > 0 ? "text-sm text-flag" : "text-sm text-success"}>
            {savedMessage()}
          </p>
        )}
      </div>
      <ErrorNotice error={saveError} />
    </form>
  );
}
