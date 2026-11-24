// Finds the values the person still has to fill in (anything still "TODO" or empty), labelled with the words
// the Form answers screen uses, so the summary names boxes the person can see. The same list, minus the
// personal sections, is what a run is told about.
// Work authorization is asked only for the countries the person can work in, never for one they did not
// choose. The dashboard's answersDraft.ts (askedCountries) follows the same rule to decide which questions
// to show.
// Spec: ARCHITECTURE.md section 5.3 (MissingValue).
import { TODO } from "@jobgoblin/schemas";
import type { MissingValue, Profile, ProfileSectionName } from "@jobgoblin/schemas";
import { homeRegionOf, regionName } from "@jobgoblin/core";

const CONTACT_LABELS = {
  fullName: "Full name",
  email: "Email address",
  phone: "Phone number",
  location: "Where you live",
} as const;

const EMPLOYMENT_LABELS = {
  noticePeriod: "Notice period",
  earliestStartDate: "Earliest start date",
  yearsExperience: "Years of experience",
} as const;

const AUTHORIZATION_LABELS = {
  authorized: "Authorized to work",
  requiresSponsorship: "Needs visa sponsorship",
  willingToRelocate: "Willing to relocate",
} as const;

const COMPENSATION_LABELS = { expectedBase: "Expected base salary" } as const;

// The countries with questions of their own. "Somewhere else" and Remote jobs have none.
const COUNTRIES_WITH_QUESTIONS: readonly string[] = ["US", "IN"];

function isStillToDo(value: unknown): boolean {
  return value === TODO || (typeof value === "string" && value.trim() === "");
}

function missingFromSection<Section extends ProfileSectionName>(
  section: Section,
  values: Record<string, unknown>,
  labels: Record<string, string>,
): MissingValue[] {
  return Object.entries(labels)
    .filter(([key]) => isStillToDo(values[key]))
    .map(([key, label]) => ({ section, key, label }));
}

// Each country chosen in "Where you can work" that has questions, and with Remote jobs chosen, the country
// where the person lives: a remote job is done from there.
export function askedCountries(profile: Profile): string[] {
  const chosen = profile.targets.regions.map((code) => code.toUpperCase());
  const asked = COUNTRIES_WITH_QUESTIONS.filter((code) => chosen.includes(code));
  const home = homeRegionOf(profile.contact.location);
  if (!chosen.includes("REMOTE") || home === null) return asked;
  if (COUNTRIES_WITH_QUESTIONS.includes(home) && !asked.includes(home)) asked.push(home);
  return asked;
}

// Nothing chosen means no work authorization question is asked, so the choice itself is what is missing.
function missingPlaces(profile: Profile): MissingValue[] {
  if (profile.targets.regions.length > 0) return [];
  return [{ section: "targets", key: "regions", label: "Where you can work" }];
}

function missingAuthorization(profile: Profile): MissingValue[] {
  const missing: MissingValue[] = [];
  for (const country of askedCountries(profile)) {
    const answers: Record<string, unknown> = { ...profile.workAuthorization.regions[country] };
    for (const [key, label] of Object.entries(AUTHORIZATION_LABELS)) {
      if (answers[key] === undefined || isStillToDo(answers[key])) {
        missing.push({ section: "workAuthorization", key: `regions.${country}.${key}`, label: `${label} (${regionName(country)})` });
      }
    }
  }
  return missing;
}

export function findMissingValues(profile: Profile): MissingValue[] {
  return [
    ...missingFromSection("contact", profile.contact, CONTACT_LABELS),
    ...missingPlaces(profile),
    ...missingAuthorization(profile),
    ...missingFromSection("employment", profile.employment, EMPLOYMENT_LABELS),
    ...missingFromSection("compensation", profile.compensation, COMPENSATION_LABELS),
  ];
}
