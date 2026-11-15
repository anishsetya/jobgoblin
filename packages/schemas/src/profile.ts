// The person's profile: the facts and form answers an application form asks for.
// Every value is a string the person could type into a form. "TODO" marks one they still have to fill in,
// so a brand-new profile (Profile.parse({})) is simply "everything is TODO".
// Spec: "Data model and storage" (profile). ARCHITECTURE.md section 5.3.
import { z } from "zod";
import { Region } from "./job";

// A value the person still has to fill in. The Form answers screen lists every TODO as a missing value,
// and an application cannot be approved while a required one is still TODO.
export const TODO = "TODO";

export const ProfileSectionName = z.enum([
  "contact",
  "workAuthorization",
  "employment",
  "compensation",
  "eeo",
  "targets",
  "rules",
]);
export type ProfileSectionName = z.infer<typeof ProfileSectionName>;

// Personal sections are never shown to a run and a run can never write them: they reach a form only
// through placeholders such as {phone}, filled in by code.
export const PERSONAL_SECTIONS = ["contact", "compensation", "eeo"] as const satisfies readonly ProfileSectionName[];

const TextOrTodo = z.string().default(TODO);
const YesNoOrTodo = z.union([z.boolean(), z.literal(TODO)]).default(TODO);

// Personal.
export const ContactSection = z.object({
  fullName: TextOrTodo,
  email: TextOrTodo,
  phone: TextOrTodo,
  location: TextOrTodo,
  linkedin: z.string().optional(),
  github: z.string().optional(),
  portfolio: z.string().optional(),
});
export type ContactSection = z.infer<typeof ContactSection>;

// One answer set per country the person can work in, keyed by region code ("US", "IN").
// A data sheet reads the answers for the job's country. A remote job that names no country is done from
// where the person lives, so it reads the answers for that country. Answers are never borrowed from another
// country: a country the person never answered for stays missing.
export const RegionAuthorization = z.object({
  authorized: YesNoOrTodo,
  requiresSponsorship: YesNoOrTodo,
  willingToRelocate: YesNoOrTodo,
});
export type RegionAuthorization = z.infer<typeof RegionAuthorization>;

export const WorkAuthorizationSection = z.object({
  regions: z.record(z.string(), RegionAuthorization).default({}),
});
export type WorkAuthorizationSection = z.infer<typeof WorkAuthorizationSection>;

export const EmploymentSection = z.object({
  currentEmployer: z.string().optional(),
  currentTitle: z.string().optional(),
  noticePeriod: TextOrTodo,
  earliestStartDate: TextOrTodo,
  yearsExperience: TextOrTodo,
});
export type EmploymentSection = z.infer<typeof EmploymentSection>;

// Personal.
export const CompensationSection = z.object({
  expectedBase: TextOrTodo,
});
export type CompensationSection = z.infer<typeof CompensationSection>;

// What EEO questions get unless the person chooses otherwise.
export const EEO_DEFAULT_ANSWER = "Decline to self-identify";
const EeoAnswer = z.string().default(EEO_DEFAULT_ANSWER);

// Personal.
export const EeoSection = z.object({
  gender: EeoAnswer,
  raceEthnicity: EeoAnswer,
  veteranStatus: EeoAnswer,
  disability: EeoAnswer,
});
export type EeoSection = z.infer<typeof EeoSection>;

// A new profile skips jobs that need a security clearance, and flags (but does not skip) jobs that
// require relocation or have a graduation-year window. The person can edit both lists on the Targets screen.
export const DEFAULT_HARD_SKIPS: readonly string[] = ["An active security clearance is required"];
export const DEFAULT_FLAGS: readonly string[] = ["Relocation required", "Graduation-year window"];

// Which jobs to look for, and what to do about the risks in them.
//   regions           where the person can work: countries ("US", "IN", "OTHER" for somewhere else) and
//                     "REMOTE" for remote jobs, which is a way of working, not a place. Chosen on the Form
//                     answers screen, above the work authorization questions it decides. None means any place.
//   cities            on-site jobs must be in one of these (such as "Austin"). None means any city. Remote
//                     jobs always count. Chosen on the Form answers screen too.
//   maxYearsRequired  the limit on "years of experience required" while the person's years of experience is
//                     missing. Once it is given, the limit is that number + 2 (core's yearsLimitFor), so this
//                     is not asked for on any screen.
//   rolesToAvoid      title words that drop a posting before any run reads it (such as "QA").
//   hardSkips         reasons a run must skip a job whatever its score (FitInput.hardSkip).
//   flags             risks a run reports in a fit, for the person to weigh; they never skip a job.
export const TargetsSection = z.object({
  roles: z.array(z.string()).default([]),
  regions: z.array(z.string()).default([]),
  cities: z.array(z.string()).default([]),
  tracks: z.array(z.string()).default([]),
  maxYearsRequired: z.number().int().nonnegative().default(4),
  rolesToAvoid: z.array(z.string()).default([]),
  hardSkips: z.array(z.string()).default([...DEFAULT_HARD_SKIPS]),
  flags: z.array(z.string()).default([...DEFAULT_FLAGS]),
});
export type TargetsSection = z.infer<typeof TargetsSection>;

// Words that must never appear on a resume, in an answer, or on a data sheet.
export const RulesSection = z.object({
  bannedTerms: z.array(z.string()).default([]),
});
export type RulesSection = z.infer<typeof RulesSection>;

// The whole profile, one value per section. `Profile.shape.targets` is the schema for one section,
// which is how the server validates `PUT /api/profile/:section`.
export const Profile = z.object({
  contact: ContactSection.prefault({}),
  workAuthorization: WorkAuthorizationSection.prefault({}),
  employment: EmploymentSection.prefault({}),
  compensation: CompensationSection.prefault({}),
  eeo: EeoSection.prefault({}),
  targets: TargetsSection.prefault({}),
  rules: RulesSection.prefault({}),
});
export type Profile = z.infer<typeof Profile>;

// One value the person still has to fill in, for the Form answers screen.
export const MissingValue = z.object({
  section: ProfileSectionName,
  key: z.string(), // the field name inside the section, such as "phone"
  label: z.string(), // plain words for the screen, such as "Phone number"
});
export type MissingValue = z.infer<typeof MissingValue>;

// The most years of experience a job may ask for before the code filter leaves it out. `experience` is the
// person's own years of experience, or null while that answer is missing (then the limit is the stored
// targets.maxYearsRequired).
export const YearsLimit = z.object({
  limit: z.number().int().nonnegative(),
  experience: z.number().int().nonnegative().nullable(),
});
export type YearsLimit = z.infer<typeof YearsLimit>;

// The response of GET /api/profile and PUT /api/profile/:section. Next to the profile, what the server
// works out from it, so the screens need no rules of their own:
//   homeRegion  the country of "Where you live" when Jobgoblin can tell it ("US", "IN", "OTHER"), or null.
//               A remote job is done from there, so it decides which questions Remote jobs asks.
//   yearsLimit  the years limit the code filter uses, as shown on the Targets screen.
export const ProfileResponse = z.object({
  profile: Profile,
  missing: z.array(MissingValue),
  homeRegion: Region.nullable(),
  yearsLimit: YearsLimit,
});
export type ProfileResponse = z.infer<typeof ProfileResponse>;
