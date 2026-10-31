// The 21 tools a Claude Code run can call at /mcp: their names, an input and an output schema for each,
// which run kinds may call which tool, and the reply every tool returns. No tool can approve, submit,
// send or confirm anything.
// The tools are listed in the order of the table in ARCHITECTURE.md section 9, with each tool's input and
// output next to each other, so the file can be read against that table. It is long because there are 42 schemas.
// Spec: "MCP tools exposed to Claude runs". ARCHITECTURE.md sections 5.11 and 9.
import { z } from "zod";
import { Application } from "./application";
import { HistoryEvent } from "./api";
import { DataSheet } from "./datasheet";
import { Band, Fit, FitInput } from "./fit";
import { HttpUrl, Region } from "./job";
import {
  EmploymentSection,
  MissingValue,
  RulesSection,
  TargetsSection,
  WorkAuthorizationSection,
} from "./profile";
import { ResumeBody, ResumeShortId, ResumeVersionId } from "./resume";
import type { RunKind } from "./run";
import { ApplicationStatus } from "./status";
import { ProposedStoryItem, StoryItem, UploadKind } from "./story";
import { Answer } from "./submission";

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

// The 21st tool, get_application, was added in decision D20: without it an ask run has no way to
// read the application it was asked about.
export const MCP_TOOL_NAMES = [
  "get_profile",
  "save_profile_section",
  "propose_story_items",
  "import_resume",
  "search_jobs",
  "add_job",
  "mark_seen",
  "get_job",
  "get_fit_context",
  "record_fit",
  "get_tailoring_context",
  "submit_resume_draft",
  "save_answers",
  "list_ready",
  "get_approved",
  "update_status",
  "get_pipeline",
  "get_application",
  "ask_person",
  "next_task",
  "complete_task",
] as const;

export const McpToolName = z.enum(MCP_TOOL_NAMES);
export type McpToolName = z.infer<typeof McpToolName>;

// ---------------------------------------------------------------------------------------------
// Tools. The input is what the run sends; the output is the `data` of a successful ToolReply.
// A tool that takes nothing still has an input schema, so every tool is registered the same way.
// Names follow the tool: get_profile has GetProfileInput and GetProfileOutput.
// ---------------------------------------------------------------------------------------------

// A short reference to an application, for tools that do not need the whole record.
const ApplicationRef = z.object({
  id: z.string(),
  company: z.string(),
  title: z.string(),
});

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
export const ImportResumeInput = z.object({});
export type ImportResumeInput = z.infer<typeof ImportResumeInput>;

export const ImportResumeOutput = z.object({
  uploads: z.array(z.object({ kind: UploadKind, fileName: z.string(), text: z.string() })),
});
export type ImportResumeOutput = z.infer<typeof ImportResumeOutput>;

// search_jobs: unseen jobs that passed the code filter. Only reads the database; the feeds were
// fetched by code before the run started.
export const SearchJobsInput = z.object({
  limit: z.number().int().positive().optional().describe("How many jobs to return at most."),
});
export type SearchJobsInput = z.infer<typeof SearchJobsInput>;

export const SearchJobsOutput = z.object({
  jobs: z.array(
    z.object({
      jobId: z.string(),
      company: z.string(),
      title: z.string(),
      location: z.string(),
      region: Region,
      snippet: z.string(), // the first 2,000 characters of the posting, wrapped as untrusted data
    }),
  ),
  remaining: z.number().int().nonnegative(), // unseen jobs left after these
});
export type SearchJobsOutput = z.infer<typeof SearchJobsOutput>;

// add_job: add a job the run found on the web. Duplicates are recognised and not added again.
export const AddJobInput = z.object({
  url: HttpUrl.optional().describe("The posting's web link, if there is one."),
  text: z.string().min(1).describe("The full text of the posting."),
  company: z.string().min(1),
  title: z.string().min(1),
  location: z.string().min(1),
});
export type AddJobInput = z.infer<typeof AddJobInput>;

export const AddJobOutput = z.object({
  jobId: z.string(),
  duplicate: z.boolean(), // true when the job was already known
});
export type AddJobOutput = z.infer<typeof AddJobOutput>;

// mark_seen: record that these jobs have been looked at, so they are never shown again.
export const MarkSeenInput = z.object({
  jobIds: z.array(z.string()).min(1),
});
export type MarkSeenInput = z.infer<typeof MarkSeenInput>;

export const MarkSeenOutput = z.object({
  marked: z.number().int().nonnegative(),
});
export type MarkSeenOutput = z.infer<typeof MarkSeenOutput>;

// get_job: one job. The posting text comes back wrapped as <untrusted_job_posting>, so instructions
// hidden inside it are treated as data.
export const GetJobInput = z.object({
  jobId: z.string(),
});
export type GetJobInput = z.infer<typeof GetJobInput>;

export const GetJobOutput = z.object({
  jobId: z.string(),
  company: z.string(),
  title: z.string(),
  location: z.string(),
  region: Region,
  url: HttpUrl.nullable(),
  text: z.string(), // wrapped
  questions: z.array(z.string()),
});
export type GetJobOutput = z.infer<typeof GetJobOutput>;

// get_fit_context: what a run needs to score a job: the rubric, the person's targets, and every
// confirmed Your story item (fit uses all of them, not only the ones on the master resume).
export const GetFitContextInput = z.object({});
export type GetFitContextInput = z.infer<typeof GetFitContextInput>;

export const GetFitContextOutput = z.object({
  rubric: z.string(),
  targets: TargetsSection,
  storyItems: z.array(StoryItem),
});
export type GetFitContextOutput = z.infer<typeof GetFitContextOutput>;

// record_fit: save a score. It takes exactly what a Fit holds before the server adds the band and
// rubric version, and creates the application if there is none yet.
export const RecordFitInput = FitInput;
export type RecordFitInput = z.infer<typeof RecordFitInput>;

export const RecordFitOutput = z.object({
  applicationId: z.string(),
  band: Band,
  status: ApplicationStatus, // where the application stands now: Scored, Long shot or Skipped (low fit)
});
export type RecordFitOutput = z.infer<typeof RecordFitOutput>;

// get_tailoring_context: what a run needs to tailor one resume.
export const GetTailoringContextInput = z.object({
  applicationId: z.string(),
});
export type GetTailoringContextInput = z.infer<typeof GetTailoringContextInput>;

export const GetTailoringContextOutput = z.object({
  application: ApplicationRef,
  master: ResumeBody, // the default selection from Your story, to start from
  storyItems: z.array(StoryItem), // every confirmed item
  mustHaves: z.array(z.string()),
  gaps: z.array(z.string()),
  bannedTerms: z.array(z.string()),
  jobSummary: z.string(),
  editNote: z.string().nullable(), // what the person asked to change, when this is a request edit
  answeredQuestions: z.array(Answer), // questions the run asked earlier and the person has answered
});
export type GetTailoringContextOutput = z.infer<typeof GetTailoringContextOutput>;

// submit_resume_draft: check and render a draft. When a check fails the reply is ok: false with
// every ResumeCheckError at once, so the run can fix them all in one go.
export const SubmitResumeDraftInput = z.object({
  applicationId: z.string(),
  body: ResumeBody,
});
export type SubmitResumeDraftInput = z.infer<typeof SubmitResumeDraftInput>;

export const SubmitResumeDraftOutput = z.object({
  versionId: ResumeVersionId,
  shortId: ResumeShortId,
  status: ApplicationStatus, // Awaiting approval once the draft passes
});
export type SubmitResumeDraftOutput = z.infer<typeof SubmitResumeDraftOutput>;

// save_answers: save screening answers for an approved application. Banned terms are checked, and
// personal placeholders such as {phone} stay as they are in the database; code fills them in only
// when it writes Answers.md.
export const SaveAnswersInput = z.object({
  applicationId: z.string(),
  answers: z.array(Answer).min(1),
});
export type SaveAnswersInput = z.infer<typeof SaveAnswersInput>;

export const SaveAnswersOutput = z.object({
  saved: z.number().int().nonnegative(),
});
export type SaveAnswersOutput = z.infer<typeof SaveAnswersOutput>;

// list_ready: the applications awaiting the person's approval.
export const ListReadyInput = z.object({});
export type ListReadyInput = z.infer<typeof ListReadyInput>;

export const ListReadyOutput = z.object({
  applications: z.array(
    z.object({
      applicationId: z.string(),
      company: z.string(),
      title: z.string(),
      fitScore: z.number().int().min(0).max(100).nullable(),
      band: Band.nullable(),
    }),
  ),
});
export type ListReadyOutput = z.infer<typeof ListReadyOutput>;

// get_approved: an approved application and the questions to answer. Personal values on the data
// sheet come back as "{key}" placeholders, never as the real values.
export const GetApprovedInput = z.object({
  applicationId: z.string(),
});
export type GetApprovedInput = z.infer<typeof GetApprovedInput>;

export const GetApprovedOutput = z.object({
  application: ApplicationRef,
  jobSummary: z.string(),
  questions: z.array(z.string()), // the application form's screening questions
  dataSheet: DataSheet, // with personal values replaced by placeholders
  answeredQuestions: z.array(Answer), // questions the run asked earlier and the person has answered
});
export type GetApprovedOutput = z.infer<typeof GetApprovedOutput>;

// update_status: no run kind may call this in the proof of concept (see RUN_KIND_TOOLS). It is here so
// the tool list matches the spec and a later run kind that reads replies can use it.
export const UpdateStatusInput = z.object({
  applicationId: z.string(),
  to: ApplicationStatus,
});
export type UpdateStatusInput = z.infer<typeof UpdateStatusInput>;

export const UpdateStatusOutput = z.object({
  status: ApplicationStatus,
});
export type UpdateStatusOutput = z.infer<typeof UpdateStatusOutput>;

// get_pipeline: counts by status, and one row per application.
export const GetPipelineInput = z.object({});
export type GetPipelineInput = z.infer<typeof GetPipelineInput>;

export const GetPipelineOutput = z.object({
  counts: z.record(ApplicationStatus, z.number().int().nonnegative()), // every status has an entry, zero included
  rows: z.array(
    z.object({
      applicationId: z.string(),
      company: z.string(),
      title: z.string(),
      status: ApplicationStatus,
      fitScore: z.number().int().min(0).max(100).nullable(),
    }),
  ),
});
export type GetPipelineOutput = z.infer<typeof GetPipelineOutput>;

// get_application: one application in full, so an ask run can answer questions about it.
export const GetApplicationInput = z.object({
  applicationId: z.string(),
});
export type GetApplicationInput = z.infer<typeof GetApplicationInput>;

export const GetApplicationOutput = z.object({
  application: Application,
  job: z.object({
    company: z.string(),
    title: z.string(),
    location: z.string(),
    url: HttpUrl.nullable(),
  }),
  fit: Fit.nullable(),
  resume: ResumeBody.nullable(),
  answers: z.array(Answer),
  history: z.array(HistoryEvent),
});
export type GetApplicationOutput = z.infer<typeof GetApplicationOutput>;

// ask_person: ask the person one question about one application. It never changes the application's
// status (decision D17). The reply's `next` tells the run to call complete_task with outcome
// "waiting" and move on to the next application.
export const AskPersonInput = z.object({
  applicationId: z.string(),
  question: z.string().min(1).describe("One question, in plain words, that only the person can answer."),
});
export type AskPersonInput = z.infer<typeof AskPersonInput>;

export const AskPersonOutput = z.object({
  questionId: z.string(),
});
export type AskPersonOutput = z.infer<typeof AskPersonOutput>;

// next_task: the next application in the run's work queue that has no open question.
export const NextTaskInput = z.object({});
export type NextTaskInput = z.infer<typeof NextTaskInput>;

export const NextTaskOutput = z.object({
  applicationId: z.string().nullable(), // null when the queue is empty
});
export type NextTaskOutput = z.infer<typeof NextTaskOutput>;

// complete_task: report how one application in the queue ended.
// "waiting" means the application now has an open question for the person (after ask_person).
export const TaskOutcome = z.enum(["done", "failed", "waiting"]);
export type TaskOutcome = z.infer<typeof TaskOutcome>;

export const CompleteTaskInput = z.object({
  applicationId: z.string(),
  outcome: TaskOutcome,
  note: z.string().optional().describe("A short plain-words note, especially when the outcome is failed."),
});
export type CompleteTaskInput = z.infer<typeof CompleteTaskInput>;

export const CompleteTaskOutput = z.object({
  done: z.number().int().nonnegative(), // tasks finished so far in this run
  total: z.number().int().nonnegative(), // tasks in this run
});
export type CompleteTaskOutput = z.infer<typeof CompleteTaskOutput>;

// ---------------------------------------------------------------------------------------------
// Which run kind may call which tool
// ---------------------------------------------------------------------------------------------

// The "Run kinds" column of the section 9 table, read per run kind. The server shows a run only the
// tools listed for its kind; anything else is refused, even if the run asks for it by name.
//   - get_profile: every kind.
//   - ask_person: paste, tailor and answers only (decision D17).
//   - update_status: no kind.
export const RUN_KIND_TOOLS: Record<RunKind, readonly McpToolName[]> = {
  setup: ["get_profile", "save_profile_section", "propose_story_items", "import_resume"],
  hunt: [
    "get_profile",
    "search_jobs",
    "add_job",
    "mark_seen",
    "get_job",
    "get_fit_context",
    "record_fit",
  ],
  paste: ["get_profile", "get_job", "get_fit_context", "record_fit", "ask_person"],
  tailor: [
    "get_profile",
    "get_job",
    "get_tailoring_context",
    "submit_resume_draft",
    "ask_person",
    "next_task",
    "complete_task",
  ],
  answers: [
    "get_profile",
    "get_job",
    "save_answers",
    "get_approved",
    "ask_person",
    "next_task",
    "complete_task",
  ],
  ask: ["get_profile", "get_job", "list_ready", "get_pipeline", "get_application"],
};

// ---------------------------------------------------------------------------------------------
// The reply
// ---------------------------------------------------------------------------------------------

// One problem, in plain words a run can act on. `path` says where, when the problem is in a part of
// the input (a ResumeCheckError fits this shape, so resume errors are returned as they are).
export const ToolError = z.object({
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
});
export type ToolError = z.infer<typeof ToolError>;

// Every tool replies with this, as JSON text. `next` names the call the run should make next, so it
// stays on its playbook; null when there is nothing more to do. Problems the run can fix (such as a
// resume that fails the truth trace) come back as ok: false with every error at once; they are values,
// not exceptions.
export type ToolReply<T> =
  | { ok: true; data: T; next: string | null }
  | { ok: false; errors: ToolError[]; next: string | null };
