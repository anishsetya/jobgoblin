// The data sheet: every form field and value that will be sent with an application, built from the profile.
// The person approves one exact sheet (identified by its hash), and personal values are replaced by
// {placeholders} before a run sees any of it, so a run can write answers without ever reading them.
// Spec: "Resume pipeline" step 9 and "Security and privacy". ARCHITECTURE.md sections 5.7 and 6.
import { TODO } from "@jobgoblin/schemas";
import type {
  DataSheet,
  DataSheetField,
  DataSheetKey,
  Profile,
  Region,
  RegionAuthorization,
} from "@jobgoblin/schemas";
import { canonicalJson, sha256Hex, shortVersionId } from "./versionId";

export type BuildDataSheetInput = {
  applicationId: string;
  profile: Profile;
  region: Region; // the job's region: work authorization answers come from it
  resumeVersion: string; // the full resume version id
};

// What each field reads its value from.
type FieldSource = {
  profile: Profile;
  authorization: RegionAuthorization | undefined;
  expectedBase: string; // the pay for the job's region
  firstName: string;
  lastName: string;
  resumeFileName: string;
  resumeShortId: string;
};

type FieldSpec = {
  key: DataSheetKey;
  label: string; // plain words for the screen
  personal: boolean; // never shown to a run
  required: boolean; // approval is refused while it is missing
  read: (source: FieldSource) => string;
};

// In the order the dashboard shows them (the order of DataSheetKey). Personal values are the contact
// details, the expected salary and the four EEO answers. The resume file name is personal too: it holds the
// person's name, and a name must not reach a run.
const FIELD_SPECS: readonly FieldSpec[] = [
  { key: "fullName", label: "Full name", personal: true, required: true, read: (s) => s.profile.contact.fullName },
  { key: "firstName", label: "First name", personal: true, required: false, read: (s) => s.firstName },
  { key: "lastName", label: "Last name", personal: true, required: false, read: (s) => s.lastName },
  { key: "email", label: "Email address", personal: true, required: true, read: (s) => s.profile.contact.email },
  { key: "phone", label: "Phone number", personal: true, required: true, read: (s) => s.profile.contact.phone },
  { key: "location", label: "Location", personal: true, required: false, read: (s) => s.profile.contact.location },
  { key: "linkedin", label: "LinkedIn profile", personal: true, required: false, read: (s) => s.profile.contact.linkedin ?? "" },
  { key: "github", label: "GitHub profile", personal: true, required: false, read: (s) => s.profile.contact.github ?? "" },
  { key: "portfolio", label: "Portfolio or website", personal: true, required: false, read: (s) => s.profile.contact.portfolio ?? "" },
  { key: "workAuthorized", label: "Authorized to work here", personal: false, required: false, read: (s) => yesOrNo(s.authorization?.authorized) },
  { key: "requiresSponsorship", label: "Needs visa sponsorship", personal: false, required: false, read: (s) => yesOrNo(s.authorization?.requiresSponsorship) },
  { key: "willingToRelocate", label: "Willing to relocate", personal: false, required: false, read: (s) => yesOrNo(s.authorization?.willingToRelocate) },
  { key: "noticePeriod", label: "Notice period", personal: false, required: false, read: (s) => s.profile.employment.noticePeriod },
  { key: "earliestStartDate", label: "Earliest start date", personal: false, required: false, read: (s) => s.profile.employment.earliestStartDate },
  { key: "yearsExperience", label: "Years of experience", personal: false, required: false, read: (s) => s.profile.employment.yearsExperience },
  { key: "currentEmployer", label: "Current employer", personal: false, required: false, read: (s) => s.profile.employment.currentEmployer ?? "" },
  { key: "currentTitle", label: "Current job title", personal: false, required: false, read: (s) => s.profile.employment.currentTitle ?? "" },
  { key: "expectedBase", label: "Expected base salary", personal: true, required: false, read: (s) => s.expectedBase },
  { key: "gender", label: "Gender", personal: true, required: false, read: (s) => s.profile.eeo.gender },
  { key: "raceEthnicity", label: "Race or ethnicity", personal: true, required: false, read: (s) => s.profile.eeo.raceEthnicity },
  { key: "veteranStatus", label: "Veteran status", personal: true, required: false, read: (s) => s.profile.eeo.veteranStatus },
  { key: "disability", label: "Disability status", personal: true, required: false, read: (s) => s.profile.eeo.disability },
  { key: "resumeFileName", label: "Resume file name", personal: true, required: false, read: (s) => s.resumeFileName },
  { key: "resumeVersion", label: "Resume version", personal: false, required: false, read: (s) => s.resumeShortId },
];

// Pay for the job's region. The older single answer is used only when the region has none of its own; a
// region the person never set up stays TODO rather than borrowing another place's answer.
function expectedBaseFor(profile: Profile, region: Region): string {
  const regionPay = profile.compensation.byRegion[region];
  if (regionPay !== undefined && regionPay.trim() !== "") return regionPay;
  return profile.compensation.expectedBase;
}

export function buildDataSheet(input: BuildDataSheetInput): DataSheet {
  const { profile } = input;
  const { firstName, lastName } = splitName(profile.contact.fullName);

  // Work authorization is never carried from one region to another: saying "authorized" for a country the
  // person was never asked about could put a false answer on a form.
  const source: FieldSource = {
    profile,
    authorization: profile.workAuthorization.regions[input.region],
    expectedBase: expectedBaseFor(profile, input.region),
    firstName,
    lastName,
    resumeFileName: resumeFileNameFor(profile.contact.fullName),
    resumeShortId: shortVersionId(input.resumeVersion),
  };

  return {
    applicationId: input.applicationId,
    region: input.region,
    fields: FIELD_SPECS.map((spec) => buildField(spec, source)),
    resumeVersion: input.resumeVersion,
    resumeFileName: source.resumeFileName,
  };
}

function buildField(spec: FieldSpec, source: FieldSource): DataSheetField {
  const value = spec.read(source);
  return {
    key: spec.key,
    label: spec.label,
    value,
    personal: spec.personal,
    required: spec.required,
    missing: value === TODO || value.trim() === "",
  };
}

function yesOrNo(answer: boolean | "TODO" | undefined): string {
  if (answer === undefined) return TODO;
  if (answer === TODO) return TODO;
  return answer ? "Yes" : "No";
}

// First name is the first word and last name is the last word, so "Mary Jane Watson" gives Mary and Watson.
// A name with unusual parts (such as "de la Cruz") is still in the full name field for the person to copy.
function splitName(fullName: string): { firstName: string; lastName: string } {
  if (fullName === TODO) return { firstName: TODO, lastName: TODO };

  const words = fullName.split(/\s+/).filter((word) => word !== "");
  const firstName = words[0] ?? "";
  const lastName = words.length > 1 ? (words[words.length - 1] ?? "") : "";
  return { firstName, lastName };
}

// "First Last - Resume.pdf": the name the company sees. Characters Windows does not allow are dropped.
function resumeFileNameFor(fullName: string): string {
  const { firstName, lastName } = splitName(fullName);
  if (firstName === TODO || firstName === "") return "Resume.pdf";

  const name = [firstName, lastName].filter((word) => word !== "").join(" ");
  const safeName = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "");
  return `${safeName} - Resume.pdf`;
}

// The fingerprint of the sheet exactly as the person saw it. Approval stores it, and a changed profile
// gives a different hash, which is how "your details changed" is noticed.
export function hashDataSheet(sheet: DataSheet): string {
  return sha256Hex(canonicalJson(sheet));
}

// The required fields (name, email, phone) that are still empty or TODO. Approval is refused while any exist.
export function requiredMissing(sheet: DataSheet): DataSheetField[] {
  return sheet.fields.filter((field) => field.required && field.missing);
}

// The same sheet with every personal value replaced by its placeholder, for example "{phone}".
// This is the only form of the sheet a run ever sees.
export function placeholderDataSheet(sheet: DataSheet): DataSheet {
  return {
    ...sheet,
    fields: sheet.fields.map((field) => (field.personal ? { ...field, value: placeholderFor(field.key) } : field)),
    resumeFileName: placeholderFor("resumeFileName"),
  };
}

function placeholderFor(key: DataSheetKey): string {
  return `{${key}}`;
}

// Puts the real values back into text a run wrote with placeholders, such as saved answers.
// A placeholder whose value is still missing stays as it is, so a gap looks like a gap and not like data.
// Text in braces that is not a field name (for example in a code sample) is left alone.
export function fillPlaceholders(text: string, sheet: DataSheet): string {
  const valueForKey = new Map<string, string>();
  for (const field of sheet.fields) {
    if (!field.missing) valueForKey.set(field.key, field.value);
  }
  return text.replace(/\{([A-Za-z]+)\}/g, (placeholder, key: string) => valueForKey.get(key) ?? placeholder);
}
