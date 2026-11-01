// Helpers for this package's tests only: temporary folders, a ready database, small builders for records,
// and a fake timer. Nothing here is exported from index.ts.
// Tests use temporary folders and databases; they never touch the person's real folders or the network.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  Application,
  Approval,
  DataSheet,
  Fit,
  HistoryEvent,
  Job,
  ResumeBody,
  ResumeVersion,
  Run,
  StoryItem,
  Submission,
} from "@jobgoblin/schemas";
import type { Database } from "./database";
import { sha256OfBytes } from "./hash";
import { defaultMigrationsDir } from "./migrations";
import { openDatabase } from "./openDatabase";
import { insertApplication } from "./tables/applications";
import { insertJobIfNew } from "./tables/jobs";
import type { ScheduledTimer, Scheduler } from "./scheduler";

export const TEST_TIMESTAMP = "2026-10-31T14:05:00.000Z";
export const TEST_NOW = new Date(TEST_TIMESTAMP);

// ---------------------------------------------------------------------------------------------
// Folders and databases
// ---------------------------------------------------------------------------------------------

const tempDirectories: string[] = [];
const openDatabases: Database[] = [];

export function makeTempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jobgoblin-"));
  tempDirectories.push(directory);
  return directory;
}

// Call from afterEach in files that create folders or databases. Windows cannot delete a database file
// while it is open, so every database opened by openTestDatabase is closed first.
export function removeTempDirs(): void {
  for (const db of openDatabases.splice(0)) {
    if (db.sqlite.isOpen) db.close();
  }
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export function openTestDatabase(appDataDir: string = makeTempDir()): Database {
  const db = openDatabase({ appDataDir, migrationsDir: defaultMigrationsDir(), backupBeforeMigrate: () => undefined });
  openDatabases.push(db);
  return db;
}

// ---------------------------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------------------------

export const aSha256 = (hexDigit: string): string => hexDigit.repeat(64);
export const aVersionId = (hexDigit: string): string => `r-${hexDigit.repeat(64)}`;

export function aJob(overrides: Partial<Job> = {}): Job {
  return {
    jobId: "greenhouse:acmecloud:4012345",
    dedupeKey: "acme cloud|backend engineer|remote",
    source: "greenhouse",
    company: "Acme Cloud",
    title: "Backend Engineer",
    location: "Remote - US",
    region: "US",
    url: "https://boards.example.com/acmecloud/jobs/4012345",
    text: "Build reliable APIs in Python and PostgreSQL.",
    questions: ["Why Acme Cloud?"],
    postedAt: "2026-10-30T09:00:00.000Z",
    foundAt: TEST_TIMESTAMP,
    seenAt: null,
    filteredReason: null,
    ...overrides,
  };
}

export function anApplication(overrides: Partial<Application> = {}): Application {
  return {
    id: "app-1",
    jobId: "greenhouse:acmecloud:4012345",
    company: "Acme Cloud",
    title: "Backend Engineer",
    status: "Found",
    fitScore: null,
    band: null,
    resumeVersion: null,
    submitMode: "manual",
    folder: null,
    appliedAt: null,
    followUpOn: null,
    tailorAttempts: 0,
    tailorError: null,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP,
    ...overrides,
  };
}

// Inserts a job and an application for it (applications have a foreign key to jobs). The job takes its
// id, company and title from the application, so `anApplicationInDatabase(db, { id: "app-2", jobId: "x:y:2" })` just works.
export function anApplicationInDatabase(db: Database, overrides: Partial<Application> = {}, jobOverrides: Partial<Job> = {}): Application {
  const application = anApplication(overrides);
  insertJobIfNew(
    db,
    aJob({ jobId: application.jobId, company: application.company, title: application.title, ...jobOverrides }),
  );
  insertApplication(db, application);
  return application;
}

export function aStoryItem(overrides: Partial<StoryItem> = {}): StoryItem {
  return {
    id: "story-1",
    kind: "experience",
    parentId: null,
    status: "confirmed",
    data: { text: "Software Engineer at Northwind Logistics", title: "Software Engineer", organization: "Northwind Logistics", tools: [], numbers: [] },
    keywords: ["python"],
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP,
    ...overrides,
  };
}

export function aResumeBody(): ResumeBody {
  return {
    headline: { src: "story-headline", text: "Backend engineer who builds reliable APIs" },
    sections: {
      experience: [{ src: "story-1", bullets: [{ src: "story-2", text: "Built a shipment-tracking API in Python" }] }],
      projects: [],
    },
    skills: [{ src: "story-skill", text: "Python" }],
    education: [{ src: "story-edu" }],
  };
}

export function aResumeVersion(overrides: Partial<ResumeVersion> = {}): ResumeVersion {
  return {
    versionId: aVersionId("a"),
    shortId: "r-aaaaaaaa",
    body: aResumeBody(),
    headerHash: aSha256("b"),
    templateVersion: "t1",
    createdAt: TEST_TIMESTAMP,
    ...overrides,
  };
}

export function aFit(overrides: Partial<Fit> = {}): Fit {
  return {
    applicationId: "app-1",
    jobId: "greenhouse:acmecloud:4012345",
    score: 82,
    track: "backend",
    mustHaves: ["Python", "PostgreSQL"],
    gaps: ["Kafka"],
    flags: ["Relocation required"],
    matchedItemIds: ["story-2"],
    reason: "Strong match on Python and PostgreSQL.",
    hardSkip: null,
    band: "apply",
    rubricVersion: "v1",
    createdAt: TEST_TIMESTAMP,
    ...overrides,
  };
}

export const PDF_BYTES = new TextEncoder().encode("%PDF-1.7 pretend this is the approved resume");
export const PDF_SHA256 = sha256OfBytes(PDF_BYTES);

export function aDataSheet(overrides: Partial<DataSheet> = {}): DataSheet {
  return {
    applicationId: "app-1",
    region: "US",
    fields: [
      { key: "fullName", label: "Full name", value: "Alex Rivera", personal: true, required: true, missing: false },
    ],
    resumeVersion: aVersionId("a"),
    resumeFileName: "Alex Rivera - Resume.pdf",
    ...overrides,
  };
}

export function anApproval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: "approval-1",
    applicationId: "app-1",
    dataSheet: aDataSheet(),
    dataSheetHash: aSha256("c"),
    resumeVersion: aVersionId("a"),
    pdfSha256: PDF_SHA256,
    submitMode: "manual",
    approvedAt: TEST_TIMESTAMP,
    usedAt: null,
    voidedAt: null,
    ...overrides,
  };
}

export function aSubmission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: "submission-1",
    applicationId: "app-1",
    resumeVersion: aVersionId("a"),
    attachedSha256: PDF_SHA256,
    proofType: "confirmation-page",
    proof: "Thank you for applying",
    submittedAt: TEST_TIMESTAMP,
    ...overrides,
  };
}

export function aRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    kind: "tailor",
    status: "queued",
    model: "haiku",
    input: {},
    sessionId: null,
    pid: null,
    step: null,
    progressDone: 0,
    progressTotal: null,
    outcomeMessage: null,
    resultText: null,
    retryOf: null,
    queuedAt: TEST_TIMESTAMP,
    startedAt: null,
    endedAt: null,
    dismissedAt: null,
    ...overrides,
  };
}

export function aHistoryEvent(overrides: Partial<HistoryEvent> = {}): HistoryEvent {
  return {
    id: "event-1",
    ts: TEST_TIMESTAMP,
    actor: "person",
    applicationId: "app-1",
    type: "note",
    from: null,
    to: null,
    detail: "Called the recruiter.",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// A timer that tests control
// ---------------------------------------------------------------------------------------------

type FakeTimer = { callback: () => void; delayMs: number; cancelled: boolean; fired: boolean };

export type FakeScheduler = {
  scheduler: Scheduler;
  // The delays of the timers that are waiting (not cancelled, not yet run), oldest first.
  pendingDelays(): number[];
  // Runs the oldest waiting timer's callback now.
  runNext(): void;
};

export function createFakeScheduler(): FakeScheduler {
  const timers: FakeTimer[] = [];
  const waiting = () => timers.filter((timer) => !timer.cancelled && !timer.fired);

  const scheduler: Scheduler = (callback, delayMs): ScheduledTimer => {
    const timer: FakeTimer = { callback, delayMs, cancelled: false, fired: false };
    timers.push(timer);
    return {
      cancel: () => {
        timer.cancelled = true;
      },
    };
  };

  return {
    scheduler,
    pendingDelays: () => waiting().map((timer) => timer.delayMs),
    runNext: () => {
      const timer = waiting()[0];
      if (timer === undefined) throw new Error("No timer is waiting.");
      timer.fired = true;
      timer.callback();
    },
  };
}
