// Helpers for the server's tests only (nothing here is used by the server itself): a ServerContext over
// temporary folders, the demo person Alex Rivera loaded from fixtures/profiles/alex-rivera.json, a clock the
// test controls, and small builders that bring an application to the state a test is about.
// Tests never touch the person's real folders or the network (feeds are read from fixtures/feeds/demo).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createResumeRenderer, type ResumeRenderer } from "@jobgoblin/render";
import { buildMasterResume, dedupeKey } from "@jobgoblin/core";
import { Profile, StoryItem, type FitInput, type Job, type ResumeBody } from "@jobgoblin/schemas";
import {
  createPersonFolder,
  insertJobIfNew,
  insertStoryItem,
  saveMasterResume,
  saveProfileSection,
  setSetting,
} from "@jobgoblin/storage";
import { z } from "zod";
import { createServerContext, type ServerContext, type StartOptions } from "../context";
import { createSilentLogger } from "../logger";
import { recordFit } from "./fits";
import { submitResumeDraft } from "./resumes";
import { openServerDatabase } from "./serverDatabase";

export const TEST_PORT = 47615;
export const TEST_SESSION_TOKEN = "test-session-token";
const START_OF_TEST_TIME = "2026-10-31T14:05:00.000Z";

export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

export function demoFeedsDir(): string {
  return path.join(repoRoot(), "fixtures", "feeds", "demo");
}

// ---------------------------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------------------------

const tempDirectories: string[] = [];
const openContexts: ServerContext[] = [];
const clocks = new WeakMap<ServerContext, { time: number }>();
let sharedRenderer: ResumeRenderer | null = null;

function makeTempDir(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jobgoblin-server-"));
  tempDirectories.push(directory);
  return directory;
}

// Compiling the Typst template takes a moment, so one renderer is shared by every test in a file.
function renderer(): ResumeRenderer {
  sharedRenderer ??= createResumeRenderer({ templatesDir: path.join(repoRoot(), "packages", "render", "templates") });
  return sharedRenderer;
}

export type TestContextOptions = {
  withFolder?: boolean; // default true: the person has chosen a folder
  withAlexRivera?: boolean; // default true: Alex's profile and confirmed story are loaded and setup is complete
  claudeCommand?: string[]; // default none: the Claude command a test wants to use (absolute paths), such as the fake claude
};

export function createTestContext(options: TestContextOptions = {}): ServerContext {
  const appDataDir = makeTempDir();
  const clock = { time: Date.parse(START_OF_TEST_TIME) };
  const now = (): Date => new Date(clock.time);

  const startOptions: StartOptions = {
    appDataDir,
    resourcesDir: repoRoot(),
    port: 0,
    claudeCommand: options.claudeCommand ?? null,
    claudeInstallCommand: null,
    feedFixturesDir: demoFeedsDir(),
    devOrigin: null,
  };
  const db = openServerDatabase({ appDataDir, resourcesDir: repoRoot(), now });
  const folder = options.withFolder === false ? null : createPersonFolder(makeTempDir());
  folder?.ensureLayout();

  const ctx = createServerContext({
    options: startOptions,
    db,
    folder,
    logger: createSilentLogger(),
    now,
    sessionToken: TEST_SESSION_TOKEN,
    renderer: renderer(),
    // Never fires: no tracker file or backup appears unless a test asks for one.
    scheduler: () => ({ cancel: () => undefined }),
  });
  ctx.port = TEST_PORT;
  if (folder !== null) setSetting(db, "personFolder", folder.root);

  clocks.set(ctx, clock);
  openContexts.push(ctx);
  if (options.withAlexRivera !== false) seedAlexRivera(ctx);
  return ctx;
}

// Moves the test clock forward.
export function advanceTime(ctx: ServerContext, milliseconds: number): void {
  const clock = clocks.get(ctx);
  if (clock === undefined) throw new Error("This context was not made by createTestContext.");
  clock.time += milliseconds;
}

// Call from afterEach. Windows cannot delete a database file while it is open, so databases close first.
export function closeTestContexts(): void {
  for (const ctx of openContexts.splice(0)) {
    if (ctx.db.sqlite.isOpen) ctx.db.close();
  }
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  }
}

// ---------------------------------------------------------------------------------------------
// The demo person
// ---------------------------------------------------------------------------------------------

const AlexFixture = z.object({ profile: Profile, storyItems: z.array(StoryItem) });

export function readAlexRivera(): z.infer<typeof AlexFixture> {
  const text = fs.readFileSync(path.join(repoRoot(), "fixtures", "profiles", "alex-rivera.json"), "utf8");
  return AlexFixture.parse(JSON.parse(text));
}

// Alex's profile and confirmed Your story, a master resume, and setup marked complete.
export function seedAlexRivera(ctx: ServerContext): void {
  const { profile, storyItems } = readAlexRivera();
  const now = ctx.now().toISOString();
  for (const section of Object.keys(profile) as (keyof Profile)[]) {
    saveProfileSection(ctx.db, section, profile[section] as never, now);
  }
  for (const item of storyItems) insertStoryItem(ctx.db, item);
  saveMasterResume(ctx.db, buildMasterResume(storyItems), now);
  setSetting(ctx.db, "setupComplete", true);
}

export function alexMasterBody(): ResumeBody {
  return buildMasterResume(readAlexRivera().storyItems);
}

// ---------------------------------------------------------------------------------------------
// Jobs, fits and applications
// ---------------------------------------------------------------------------------------------

export function aJob(overrides: Partial<Job> = {}): Job {
  const base = {
    jobId: "greenhouse:acmecloud:1001",
    source: "greenhouse" as const,
    company: "Acme Cloud",
    title: "Backend Engineer",
    location: "Remote - US",
    region: "US" as const,
    url: "https://boards.example.com/acmecloud/jobs/1001",
    text: "Build reliable APIs in Python and PostgreSQL. You have 1 to 3 years of experience.",
    questions: ["Why Acme Cloud?"],
    postedAt: null,
    foundAt: START_OF_TEST_TIME,
    seenAt: null,
    filteredReason: null,
    ...overrides,
  };
  return { dedupeKey: dedupeKey(base.company, base.title, base.location), ...base, ...overrides };
}

export function anInsertedJob(ctx: ServerContext, overrides: Partial<Job> = {}): Job {
  const job = aJob(overrides);
  insertJobIfNew(ctx.db, job);
  return job;
}

export function aFitInput(jobId: string, overrides: Partial<FitInput> = {}): FitInput {
  return {
    jobId,
    score: 86,
    track: "backend",
    mustHaves: ["Python", "PostgreSQL"],
    gaps: [],
    flags: [],
    matchedItemIds: ["ach-northwind-tracking-api"],
    reason: "Strong match on Python and PostgreSQL.",
    hardSkip: null,
    ...overrides,
  };
}

// A job in the database and its application, scored by a run. Returns the application's id.
export function aScoredApplication(
  ctx: ServerContext,
  job: Partial<Job> = {},
  fit: Partial<FitInput> = {},
): string {
  const inserted = anInsertedJob(ctx, job);
  const outcome = recordFit(ctx, aFitInput(inserted.jobId, fit));
  if (!outcome.ok) throw new Error(`The fit was refused: ${outcome.errors[0]?.message ?? ""}`);
  return outcome.value.applicationId;
}

// An application whose resume (Alex's master resume) has passed every check and awaits approval.
export async function anApplicationAwaitingApproval(ctx: ServerContext, job: Partial<Job> = {}): Promise<string> {
  const applicationId = aScoredApplication(ctx, job);
  const outcome = await submitResumeDraft(ctx, { applicationId, body: alexMasterBody() });
  if (!outcome.ok) throw new Error(`The draft was refused: ${outcome.errors.map((e) => e.message).join(" ")}`);
  return applicationId;
}
