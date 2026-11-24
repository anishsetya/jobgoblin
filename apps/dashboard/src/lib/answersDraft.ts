// Converts the Form answers screen between the profile (what the server stores) and a "draft" (what the
// boxes hold). The server marks a value the person still has to give as "TODO"; a text box should simply be
// empty in that case, and an empty box becomes "TODO" again when saved.
// "Where you can work" is in the draft too. It decides which work authorization questions are shown
// (askedCountries), and it is saved in the targets section, where the job filter reads it.
// Spec: PRD P3 ("Every TODO is visible on one screen"), ARCHITECTURE.md section 5.3.
import { TODO, type Profile, type ProfileResponse } from "@jobgoblin/schemas";

export type YesNoOrTodo = boolean | typeof TODO;
export type YesNoDraft = "yes" | "no" | "todo";

export type RegionDraft = {
  authorized: YesNoDraft;
  requiresSponsorship: YesNoDraft;
  willingToRelocate: YesNoDraft;
};

export type PlacesDraft = {
  regions: string[]; // country codes ("US", "IN", "OTHER") and "REMOTE" for remote jobs
  cities: string[];
};

export type AnswersDraft = {
  contact: { fullName: string; email: string; phone: string; location: string; linkedin: string; github: string; portfolio: string };
  employment: { currentEmployer: string; currentTitle: string; noticePeriod: string; earliestStartDate: string; yearsExperience: string };
  compensation: { expectedBase: string };
  eeo: { gender: string; raceEthnicity: string; veteranStatus: string; disability: string };
  places: PlacesDraft;
  regions: Record<string, RegionDraft>; // work authorization answers, by country code
};

// The places offered under "Where you can work", in the order shown.
export const PLACE_CHOICES: readonly string[] = ["US", "IN", "OTHER", "REMOTE"];

// The words for a place: a country by its name, and REMOTE as "Remote jobs", since it is a way of working.
export function placeNameKey(code: string): string {
  return code === "REMOTE" ? "profile:answers.places.remote" : `common:region.${code}`;
}

// The chosen places in the order of PLACE_CHOICES, so ticking and unticking never reorders what is saved.
// A code from elsewhere (an older profile) is kept, after the known ones.
export function orderedPlaces(regions: readonly string[]): string[] {
  const known = PLACE_CHOICES.filter((code) => regions.includes(code));
  return [...known, ...regions.filter((code) => !PLACE_CHOICES.includes(code))];
}

// The countries with work authorization questions of their own. "Somewhere else" and Remote jobs have none.
export const COUNTRIES_WITH_QUESTIONS: readonly string[] = ["US", "IN"];

// The countries whose questions are shown: each chosen country that has questions, and with Remote jobs chosen,
// the country where the person lives, since a remote job is done from there. The server's missingValues.ts
// (askedCountries) follows the same rule, so the summary and the screen agree.
export function askedCountries(regions: readonly string[], homeRegion: string | null): string[] {
  const asked = COUNTRIES_WITH_QUESTIONS.filter((code) => regions.includes(code));
  if (!regions.includes("REMOTE") || homeRegion === null) return asked;
  if (COUNTRIES_WITH_QUESTIONS.includes(homeRegion) && !asked.includes(homeRegion)) asked.push(homeRegion);
  return asked;
}

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

export function draftFromProfile(response: Pick<ProfileResponse, "profile" | "homeRegion">): AnswersDraft {
  const { contact, employment, compensation, eeo, workAuthorization, targets } = response.profile;

  // A block for every country with questions, so ticking one shows its questions at once.
  const savedCodes = Object.keys(workAuthorization.regions).filter((code) => !COUNTRIES_WITH_QUESTIONS.includes(code));
  const regions: Record<string, RegionDraft> = {};
  for (const code of [...COUNTRIES_WITH_QUESTIONS, ...savedCodes]) {
    const answers = workAuthorization.regions[code];
    regions[code] = {
      authorized: fromYesNo(answers?.authorized ?? TODO),
      requiresSponsorship: fromYesNo(answers?.requiresSponsorship ?? TODO),
      willingToRelocate: fromYesNo(answers?.willingToRelocate ?? TODO),
    };
  }

  // Nothing is assumed: with no places chosen yet, only the country of where the person lives is ticked
  // (when Jobgoblin can tell it), for them to check before saving.
  const homeOnly = response.homeRegion === null ? [] : [response.homeRegion];
  const places: PlacesDraft = {
    regions: targets.regions.length > 0 ? [...targets.regions] : homeOnly,
    cities: [...targets.cities],
  };

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
    places,
    regions,
  };
}

// Listing cities to work from says the person works where they are, so an unanswered "Willing to relocate"
// in the questions shown becomes No when the first city is added. It is only a suggestion: the person sees it
// and can change it before saving.
export function withCities(draft: AnswersDraft, cities: string[], homeRegion: string | null): AnswersDraft {
  const regions = { ...draft.regions };
  if (draft.places.cities.length === 0 && cities.length > 0) {
    for (const code of askedCountries(draft.places.regions, homeRegion)) {
      const region = regions[code];
      if (region !== undefined && region.willingToRelocate === "todo") regions[code] = { ...region, willingToRelocate: "no" };
    }
  }
  return { ...draft, places: { ...draft.places, cities }, regions };
}

// A region the person has not touched is not saved, so it does not add answers for places they never chose.
function regionHasAnswers(region: RegionDraft): boolean {
  return region.authorized !== "todo" || region.requiresSponsorship !== "todo" || region.willingToRelocate !== "todo";
}

export type DraftSections = Pick<Profile, "contact" | "workAuthorization" | "employment" | "compensation" | "eeo" | "targets">;

// The sections to save. The targets keep everything the Targets screen owns (roles, roles to avoid...) as they
// are saved now, and take only the places and cities from this screen.
export function sectionsFromDraft(draft: AnswersDraft, savedProfile: Profile): DraftSections {
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
    targets: { ...savedProfile.targets, regions: [...draft.places.regions], cities: [...draft.places.cities] },
  };
}
