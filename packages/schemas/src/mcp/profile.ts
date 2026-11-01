// MCP tools about the person: get_profile, save_profile_section, propose_story_items, import_resume.
// All of them are for the setup run, except get_profile, which every run may call. Input is what the run
// sends; output is the `data` of a successful ToolReply. Names follow the tool: get_profile has GetProfileInput
// and GetProfileOutput.
// Spec: ARCHITECTURE.md section 9.
import { z } from "zod";
import { EmploymentSection, MissingValue, RulesSection, TargetsSection, WorkAuthorizationSection } from "../profile";
import { ProposedStoryItem, UploadKind } from "../story";

// get_profile: the profile without its personal sections. Contact details, compensation and EEO
// answers are never returned, so they can never reach a run.
export const GetProfileInput = z.object({});
export type GetProfileInput = z.infer<typeof GetProfileInput>;

export const GetProfileOutput = z.object({
  facts: z.object({
    workAuthorization: WorkAuthorizationSection,
    employment: EmploymentSection,
  }),
  missing: z.array(MissingValue),
  targets: TargetsSection,
  rules: RulesSection,
});
export type GetProfileOutput = z.infer<typeof GetProfileOutput>;

// save_profile_section: the sections a run may write. Not the personal ones (contact, compensation,
// EEO): only the person writes those. And not rules: a run that could edit the banned terms could
// switch off the person's own guard. The tool also fills only values that are still TODO or empty,
// so a run can never overwrite something the person typed.
// `data` is checked against the section's schema (Profile.shape[section]) when the tool runs.
export const RunWritableSection = z.enum(["employment", "workAuthorization", "targets"]);
export type RunWritableSection = z.infer<typeof RunWritableSection>;

export const SaveProfileSectionInput = z.object({
  section: RunWritableSection,
  data: z.record(z.string(), z.unknown()),
});
export type SaveProfileSectionInput = z.infer<typeof SaveProfileSectionInput>;

export const SaveProfileSectionOutput = z.object({
  section: RunWritableSection,
  filledKeys: z.array(z.string()), // the values this call filled in
});
export type SaveProfileSectionOutput = z.infer<typeof SaveProfileSectionOutput>;

// propose_story_items: add items to Your story as pending. Only the person can confirm them.
export const ProposeStoryItemsInput = z.object({
  items: z.array(ProposedStoryItem).min(1),
});
export type ProposeStoryItemsInput = z.infer<typeof ProposeStoryItemsInput>;

export const ProposeStoryItemsOutput = z.object({
  created: z.array(z.object({ tempId: z.string(), id: z.string() })), // each label and the real id it became
});
export type ProposeStoryItemsOutput = z.infer<typeof ProposeStoryItemsOutput>;

// import_resume: the text of the uploaded documents, with contact details already taken out (decision D10).
// `fileName` is a neutral "resume.pdf" or "linkedin.pdf", never the person's own file name, which usually
// holds their name.
export const ImportResumeInput = z.object({});
export type ImportResumeInput = z.infer<typeof ImportResumeInput>;

export const ImportResumeOutput = z.object({
  uploads: z.array(z.object({ kind: UploadKind, fileName: z.string(), text: z.string() })),
});
export type ImportResumeOutput = z.infer<typeof ImportResumeOutput>;
