// Converts the Form answers screen between the profile (what the server stores) and a "draft" (what the
// text boxes hold). The server marks a value the person still has to give as "TODO"; a text box should
// simply be empty in that case, and an empty box becomes "TODO" again when saved.
// Spec: PRD P3 ("Every TODO is visible on one screen"), ARCHITECTURE.md section 5.3.
import { TODO, type Profile } from "@jobgoblin/schemas";

export type YesNoOrTodo = boolean | typeof TODO;
export type YesNoDraft = "yes" | "no" | "todo";

export type RegionDraft = {
  authorized: YesNoDraft;
  requiresSponsorship: YesNoDraft;
  willingToRelocate: YesNoDraft;
};

export type AnswersDraft = {
  contact: { fullName: string; email: string; phone: string; location: string; linkedin: string; github: string; portfolio: string };
  employment: { currentEmployer: string; currentTitle: string; noticePeriod: string; earliestStartDate: string; yearsExperience: string };
  compensation: { expectedBase: string };
  eeo: { gender: string; raceEthnicity: string; veteranStatus: string; disability: string };
  regions: Record<string, RegionDraft>;
};

// Work authorization answers are asked for these regions even before the person has given any.
export const DEFAULT_REGIONS: readonly string[] = ["US", "IN"];

function fromTodo(value: string): string {
  return value === TODO ? "" : value;
}

function toTodo(text: string): string {
  const trimmed = text.trim();
  return trimmed === "" ? TODO : trimmed;
}

function toOptional(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed === "" ? undefined : trimmed;
}

function fromYesNo(value: YesNoOrTodo): YesNoDraft {
  if (value === TODO) return "todo";
  return value ? "yes" : "no";
}

function toYesNo(draft: YesNoDraft): YesNoOrTodo {
  if (draft === "todo") return TODO;
  return draft === "yes";
}

export function draftFromProfile(profile: Profile): AnswersDraft {
  const { contact, employment, compensation, eeo, workAuthorization } = profile;

  const regionCodes = [...DEFAULT_REGIONS, ...Object.keys(workAuthorization.regions).filter((code) => !DEFAULT_REGIONS.includes(code))];
  const regions: Record<string, RegionDraft> = {};
  for (const code of regionCodes) {
    const answers = workAuthorization.regions[code];
    regions[code] = {
      authorized: fromYesNo(answers?.authorized ?? TODO),
      requiresSponsorship: fromYesNo(answers?.requiresSponsorship ?? TODO),
      willingToRelocate: fromYesNo(answers?.willingToRelocate ?? TODO),
    };
  }

  return {
    contact: {
      fullName: fromTodo(contact.fullName),
      email: fromTodo(contact.email),
      phone: fromTodo(contact.phone),
      location: fromTodo(contact.location),
      linkedin: contact.linkedin ?? "",
      github: contact.github ?? "",
      portfolio: contact.portfolio ?? "",
    },
    employment: {
      currentEmployer: employment.currentEmployer ?? "",
      currentTitle: employment.currentTitle ?? "",
      noticePeriod: fromTodo(employment.noticePeriod),
      earliestStartDate: fromTodo(employment.earliestStartDate),
      yearsExperience: fromTodo(employment.yearsExperience),
    },
    compensation: { expectedBase: fromTodo(compensation.expectedBase) },
    eeo: { ...eeo },
    regions,
  };
}

// A region the person has not touched is not saved, so it does not add "missing" values for places
// they never apply in.
function regionHasAnswers(region: RegionDraft): boolean {
  return region.authorized !== "todo" || region.requiresSponsorship !== "todo" || region.willingToRelocate !== "todo";
}

export function sectionsFromDraft(draft: AnswersDraft, savedProfile: Profile): Pick<Profile, "contact" | "workAuthorization" | "employment" | "compensation" | "eeo"> {
  const regions: Profile["workAuthorization"]["regions"] = {};
  for (const [code, region] of Object.entries(draft.regions)) {
    if (!regionHasAnswers(region) && savedProfile.workAuthorization.regions[code] === undefined) continue;
    regions[code] = {
      authorized: toYesNo(region.authorized),
      requiresSponsorship: toYesNo(region.requiresSponsorship),
      willingToRelocate: toYesNo(region.willingToRelocate),
    };
  }

  return {
    contact: {
      fullName: toTodo(draft.contact.fullName),
      email: toTodo(draft.contact.email),
      phone: toTodo(draft.contact.phone),
      location: toTodo(draft.contact.location),
      linkedin: toOptional(draft.contact.linkedin),
      github: toOptional(draft.contact.github),
      portfolio: toOptional(draft.contact.portfolio),
    },
    workAuthorization: { regions },
    employment: {
      currentEmployer: toOptional(draft.employment.currentEmployer),
      currentTitle: toOptional(draft.employment.currentTitle),
      noticePeriod: toTodo(draft.employment.noticePeriod),
      earliestStartDate: toTodo(draft.employment.earliestStartDate),
      yearsExperience: toTodo(draft.employment.yearsExperience),
    },
    compensation: { expectedBase: toTodo(draft.compensation.expectedBase) },
    eeo: { ...draft.eeo },
  };
}
