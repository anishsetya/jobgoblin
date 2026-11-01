// The local HTTP API's shapes: errors, the Today and Pipeline responses, the Application detail,
// the person's requests (approve, submitted, status change, add a job), and settings.
// The dashboard and the server both parse with these, so the two cannot drift apart.
// Spec: "Local HTTP API and authentication". ARCHITECTURE.md sections 5.9 and 11.
import { z } from "zod";
import { Application } from "./application";
import { Approval, DataSheet } from "./dataSheet";
import { Band, Fit } from "./fit";
import { Job, Region } from "./job";
import { ApplicationResume, ResumeDiff, ResumeHeader, ResumeVersion, Sha256Hex } from "./resume";
import { Question, Run } from "./run";
import { Actor, ApplicationStatus } from "./status";
import { StoryItem, StoryItemData, StoryItemKind } from "./story";
import { Answer, ProofType, Submission } from "./submission";

// Every failed request returns this and nothing else, never a stack trace. `message` says what
// happened and `action` says what to do next, both in plain words with no blame, shown as they are.
export const ApiError = z.object({
  code: z.string(), // for example "data-sheet-changed"; for code to branch on, not for the screen
  message: z.string(),
  action: z.string(),
});
export type ApiError = z.infer<typeof ApiError>;

// One thing waiting on the person, shown in Today's "Needs you" list.
//   not-tailored  the application could not be tailored (for example the per-company cap), see tailorError
export const NeedsYouKind = z.enum([
  "review",
  "question",
  "ready-to-submit",
  "long-shot",
  "not-tailored",
  "follow-up-due",
  "run-attention",
]);
export type NeedsYouKind = z.infer<typeof NeedsYouKind>;

export const NeedsYouItem = z.object({
  kind: NeedsYouKind,
  // The id of the thing that needs the person: the question's id for "question", the run's id for
  // "run-attention", and the application's id for every other kind.
  id: z.string(),
  applicationId: z.string().nullable(),
  runId: z.string().nullable(),
  title: z.string(),
  detail: z.string(),
  createdAt: z.iso.datetime(),
});
export type NeedsYouItem = z.infer<typeof NeedsYouItem>;

export const TodayResponse = z.object({
  needsYou: z.array(NeedsYouItem),
  running: z.array(Run), // each shown as a card with its step, progress and Cancel
  doneToday: z.object({
    found: z.number().int().nonnegative(),
    tailored: z.number().int().nonnegative(),
    approved: z.number().int().nonnegative(),
    applied: z.number().int().nonnegative(),
  }),
  setupComplete: z.boolean(),
  usageNoticeSeen: z.boolean(), // false until the person has read the plan-usage notice before a first run
});
export type TodayResponse = z.infer<typeof TodayResponse>;

// The filters of the Pipeline screen, after the route has read them from the URL's query string.
export const PipelineQuery = z.object({
  status: z.array(ApplicationStatus).optional(),
  search: z.string().optional(),
  band: z.array(Band).optional(),
  overdueOnly: z.boolean().optional(),
});
export type PipelineQuery = z.infer<typeof PipelineQuery>;

export const PipelineRow = Application.extend({
  overdue: z.boolean(), // the follow-up day has passed (shown in amber)
  location: z.string(), // from the job
  region: Region,
});
export type PipelineRow = z.infer<typeof PipelineRow>;

// The kinds of change the history log records. Closed on purpose, so a screen can give every one of
// them a plain-words line.
export const HISTORY_EVENT_TYPES = [
  "status-changed",
  "tailor-requested",
  "resume-drafted",
  "approved",
  "re-approved",
  "approval-voided",
  "question-asked",
  "question-answered",
  "answers-saved",
  "submitted",
  "note",
] as const;

export const HistoryEventType = z.enum(HISTORY_EVENT_TYPES);
export type HistoryEventType = z.infer<typeof HistoryEventType>;

// One row of the change log. Rows are only ever added: the database blocks edits and deletes.
// It is not called Event because browsers already define a global type with that name.
export const HistoryEvent = z.object({
  id: z.string(),
  ts: z.iso.datetime(),
  actor: Actor,
  applicationId: z.string().nullable(),
  type: HistoryEventType,
  from: z.string().nullable(), // for status-changed, the status before
  to: z.string().nullable(), // for status-changed, the status after
  detail: z.string().nullable(),
});
export type HistoryEvent = z.infer<typeof HistoryEvent>;

// An answer the person got from "Ask about this application".
export const AskResult = z.object({
  question: z.string(),
  answer: z.string(),
  at: z.iso.datetime(),
});
export type AskResult = z.infer<typeof AskResult>;

// What the person can do with this application right now, worked out by the server with the rules
// in packages/core. The dashboard only shows or hides buttons from these; it never decides for itself.
export const ApplicationActions = z.object({
  canApprove: z.boolean(),
  canSkip: z.boolean(),
  canUndoSkip: z.boolean(),
  canRequestEdit: z.boolean(),
  canTailor: z.boolean(),
  canWithdraw: z.boolean(),
  canMarkSubmitted: z.boolean(),
  canAsk: z.boolean(),
});
export type ApplicationActions = z.infer<typeof ApplicationActions>;

// Everything the Review, Open application and Application screens need, in one response.
export const ApplicationDetail = z.object({
  application: Application,
  job: Job,
  fit: Fit.nullable(), // null until a run has scored the job
  resume: ResumeVersion.nullable(), // the application's current resume version
  resumeHeader: ResumeHeader.nullable(), // built from the contact section, for the dashboard's preview
  versions: z.array(ApplicationResume), // every resume this application has used
  diff: ResumeDiff.nullable(), // the current resume against the master resume
  storyItems: z.array(StoryItem), // the items the resume cites, plus the items the fit matched
  dataSheet: DataSheet.nullable(),
  dataSheetHash: Sha256Hex.nullable(), // sent back on approve, so approval covers exactly this sheet
  approval: Approval.nullable(),
  answers: z.array(Answer),
  submission: Submission.nullable(),
  questions: z.array(Question),
  history: z.array(HistoryEvent),
  askResults: z.array(AskResult),
  allowedStatusMoves: z.array(ApplicationStatus), // the moves the status menu may offer the person
  actions: ApplicationActions,
});
export type ApplicationDetail = z.infer<typeof ApplicationDetail>;

export const ApproveRequest = z.object({
  dataSheetHash: Sha256Hex,
  submitMode: z.literal("manual"), // the proof of concept has no extension
});
export type ApproveRequest = z.infer<typeof ApproveRequest>;

export const SubmittedRequest = z.object({
  proofType: ProofType,
  proof: z.string(),
  attachedSha256: Sha256Hex.nullable(),
  // Set when the person has been told the attached file is not the approved one and applies anyway.
  confirmDifferentFile: z.boolean().optional(),
});
export type SubmittedRequest = z.infer<typeof SubmittedRequest>;

export const StatusChangeRequest = z.object({
  to: ApplicationStatus,
  followUpOn: z.iso.date().nullable().optional(),
  note: z.string().optional(),
});
export type StatusChangeRequest = z.infer<typeof StatusChangeRequest>;

// A link, the pasted job text, or both. An empty string counts as not given.
// Text has no company or title of its own, so the person must give them whenever they paste text;
// with only a link, the server reads them from the page.
// Each problem is reported at its own field, so the form can mark the right box.
export const AddJobRequest = z
  .object({
    url: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    company: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    location: z.string().min(1).optional(),
  })
  .superRefine((request, context) => {
    if (request.url === undefined && request.text === undefined) {
      context.addIssue({ code: "custom", message: "Add a link or paste the job text." });
    }
    if (request.text === undefined) return;
    if (request.company === undefined) {
      context.addIssue({ code: "custom", path: ["company"], message: "Add the company name." });
    }
    if (request.title === undefined) {
      context.addIssue({ code: "custom", path: ["title"], message: "Add the job title." });
    }
  });
export type AddJobRequest = z.infer<typeof AddJobRequest>;

export const AddJobResponse = z.object({
  applicationId: z.string().nullable(),
  runId: z.string().nullable(), // the paste run that scores the job; null when nothing was queued
  needsText: z.boolean(), // true when the link needs a login or could not be read
  message: z.string(), // plain words for the screen
});
export type AddJobResponse = z.infer<typeof AddJobResponse>;

export const ClaudeState = z.enum(["connected", "not-installed", "update-needed", "signed-out"]);
export type ClaudeState = z.infer<typeof ClaudeState>;

export const ClaudeStatus = z.object({
  state: ClaudeState,
  version: z.string().nullable(),
  minimumVersion: z.string(),
  installCommand: z.string(), // shown to the person before it runs
  signInCommand: z.string(),
  plan: z.string().nullable(), // the person's Claude plan, when Claude Code reports it
});
export type ClaudeStatus = z.infer<typeof ClaudeStatus>;

// The settings the person can change. Every field has a default, so `Settings.parse({})` is a fresh
// install. The command that starts Claude Code is deliberately not here (decision D21): it is a start
// option, because a setting could be changed through the API to run any program.
export const Settings = z.object({
  personFolder: z.string().nullable().default(null),
  concurrency: z.union([z.literal(1), z.literal(2)]).default(1), // runs at a time; they share the person's plan
  maxOpenPerCompany: z.number().int().positive().default(3), // PRD T4
  reapplyDays: z.number().int().nonnegative().default(90), // days before applying to the same job again
  followUpDays: z.number().int().positive().default(7), // days after applying until a follow-up is due
  usageNoticeSeen: z.boolean().default(false),
  setupComplete: z.boolean().default(false),
});
export type Settings = z.infer<typeof Settings>;

// ok: the tracker files are current. locked: Excel has the file open, so the export retries later.
// off: no folder chosen yet.
export const TrackerStatus = z.enum(["ok", "locked", "off"]);
export type TrackerStatus = z.infer<typeof TrackerStatus>;

// What the Settings screen reads: the settings plus facts the server knows but the person does not set.
export const SettingsResponse = Settings.extend({
  lastBackupAt: z.iso.datetime().nullable(),
  trackerStatus: TrackerStatus,
  dataFolder: z.string(), // the app data folder, shown read-only
});
export type SettingsResponse = z.infer<typeof SettingsResponse>;

export const Backup = z.object({
  id: z.string(), // the backup's file name
  createdAt: z.iso.datetime(),
  sizeBytes: z.number().int().nonnegative(),
});
export type Backup = z.infer<typeof Backup>;

// The answer to choosing a folder. If the folder already holds backups (a new computer, say),
// they are listed so the wizard can offer Restore.
export const ChooseFolderResponse = z.object({
  settings: SettingsResponse,
  backupsFound: z.array(Backup),
});
export type ChooseFolderResponse = z.infer<typeof ChooseFolderResponse>;

// POST /api/story: the person adds an item by hand. It starts pending, like everything else in Your story.
export const AddStoryItemRequest = z.object({
  kind: StoryItemKind,
  parentId: z.string().nullable(),
  data: StoryItemData,
  keywords: z.array(z.string()).default([]),
});
export type AddStoryItemRequest = z.infer<typeof AddStoryItemRequest>;

// PUT /api/story/:id: an edit returns the item to pending until the person confirms it again.
export const EditStoryItemRequest = z.object({
  data: StoryItemData,
  keywords: z.array(z.string()).default([]),
});
export type EditStoryItemRequest = z.infer<typeof EditStoryItemRequest>;

// POST /api/import-resume. runId is the setup run started after a resume upload; null after a LinkedIn
// upload alone, which waits for the resume.
export const ImportResumeResponse = z.object({
  runId: z.string().nullable(),
});
export type ImportResumeResponse = z.infer<typeof ImportResumeResponse>;

// POST /api/open. opened is false outside the desktop app; the dashboard then shows the path instead.
export const OpenPathResponse = z.object({
  opened: z.boolean(),
  path: z.string(),
});
export type OpenPathResponse = z.infer<typeof OpenPathResponse>;
