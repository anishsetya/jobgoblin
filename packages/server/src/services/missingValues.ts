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

// The regions the person applies in: the ones they chose, plus any they already gave answers for. No region
// is assumed; until one is chosen there is nothing to ask about work authorization or pay.
function regionsOf(profile: Profile): string[] {
  return [...new Set([...profile.targets.regions, ...Object.keys(profile.workAuthorization.regions)])];
}

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

  const missing: MissingValue[] = [];
  for (const region of regionsOf(profile)) {
    const answers: Record<string, unknown> = { ...regions[region] };
    for (const [key, label] of Object.entries(AUTHORIZATION_LABELS)) {
      if (answers[key] === undefined || isStillToDo(answers[key])) {
        missing.push({ section: "workAuthorization", key: `regions.${region}.${key}`, label: `${label} (${region})` });
      }
    }
  }
  return missing;
}

// Pay is asked for each region. A region with no pay of its own can use the older single answer.
function missingPay(profile: Profile): MissingValue[] {
  const { byRegion, expectedBase } = profile.compensation;
  if (!isStillToDo(expectedBase)) return [];

  return regionsOf(profile)
    // A region with no entry at all is as unanswered as one still marked TODO.
    .filter((region) => byRegion[region] === undefined || isStillToDo(byRegion[region]))
    .map((region) => ({
      section: "compensation",
      key: `byRegion.${region}`,
      label: `Expected base salary (${region})`,
    }));
}

// Everything about work authorization and pay hangs on the places the person applies in, so not having
// chosen any is the first thing to ask.
function missingPlaces(profile: Profile): MissingValue[] {
  if (regionsOf(profile).length > 0) return [];
  return [{ section: "targets", key: "regions", label: "Where you want to work" }];
}

export function findMissingValues(profile: Profile): MissingValue[] {
  return [
    ...missingFromSection("contact", profile.contact, CONTACT_LABELS),
    ...missingPlaces(profile),
    ...missingAuthorization(profile),
    ...missingFromSection("employment", profile.employment, EMPLOYMENT_LABELS),
    ...missingPay(profile),
  ];
}
