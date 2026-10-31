// Finds the values the person still has to fill in (anything still "TODO" or empty), with plain labels for
// the Form answers screen. The same list, minus the personal sections, is what a run is told about.
// Spec: ARCHITECTURE.md section 5.3 (MissingValue).
import { TODO } from "@jobgoblin/schemas";
import type { MissingValue, Profile, ProfileSectionName } from "@jobgoblin/schemas";

const CONTACT_LABELS = {
  fullName: "Full name",
  email: "Email address",
  phone: "Phone number",
  location: "Location",
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

// A region the person has not set up still gets asked about, because the data sheet falls back to US.
const DEFAULT_REGION = "US";

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

function missingAuthorization(profile: Profile): MissingValue[] {
  const regions = profile.workAuthorization.regions;
  const regionNames = Object.keys(regions);
  if (!regionNames.includes(DEFAULT_REGION)) regionNames.unshift(DEFAULT_REGION);

  const missing: MissingValue[] = [];
  for (const region of regionNames) {
    const answers: Record<string, unknown> = { ...regions[region] };
    for (const [key, label] of Object.entries(AUTHORIZATION_LABELS)) {
      if (answers[key] === undefined || isStillToDo(answers[key])) {
        missing.push({ section: "workAuthorization", key: `regions.${region}.${key}`, label: `${label} (${region})` });
      }
    }
  }
  return missing;
}

export function findMissingValues(profile: Profile): MissingValue[] {
  return [
    ...missingFromSection("contact", profile.contact, CONTACT_LABELS),
    ...missingAuthorization(profile),
    ...missingFromSection("employment", profile.employment, EMPLOYMENT_LABELS),
    ...missingFromSection("compensation", profile.compensation, { expectedBase: "Expected base salary" }),
  ];
}
