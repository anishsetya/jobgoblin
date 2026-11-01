// ServerContext: the one object every service receives as its first argument. It holds the things a use case
// needs (database, the person's folder, the event bus, the clock, the tracker and backups) so that no service
// reaches for a global, and a test can build a context over a temporary folder.
// `db` and `folder` are mutable on purpose: restoring a backup swaps the database and choosing a folder swaps
// the folder, while the tracker and backups keep running. They are given getters (`() => ctx.db`).
// Spec: ARCHITECTURE.md section 10 (ServerContext, EventBus, StartOptions).
import path from "node:path";
import type { ModelTier, RunInput, RunKind } from "@jobgoblin/schemas";
import { createResumeRenderer, type ResumeRenderer } from "@jobgoblin/render";
import {
  createBackups,
  createTrackerExporter,
  type Backups,
  type Database,
  type PersonFolder,
  type Scheduler,
  type TrackerExporter,
} from "@jobgoblin/storage";
import { createRunTokens, type RunTokens } from "./auth/runTokens";
import { createSessionToken } from "./auth/tokens";
import { createEventBus, type EventBus } from "./bus";
import type { Logger } from "./logger";

// What the person's computer tells the server when it starts (flags and environment, see main.ts).
export type StartOptions = {
  appDataDir: string;
  resourcesDir: string;
  port: number; // 0 picks any free port (tests)
  claudeCommand: string[] | null; // the Claude Code command, as absolute paths; a start option, never a setting (D21)
  claudeInstallCommand: string[] | null;
  feedFixturesDir: string | null; // set: feeds are read from saved files and nothing touches the network
  devOrigin: string | null; // the dashboard dev server's origin, allowed in addition to the server's own
};

export type QueueRunRequest = {
  kind: RunKind;
  applicationIds: string[];
  input: RunInput;
  model?: ModelTier;
  retryOf?: string;
};

// Set by the run launcher once it exists. Until then `wake` does nothing and a running run cannot be stopped.
//   wake    start queued runs if there is room (the queue calls it after every change)
//   cancel  stop a running run's process and record "cancelled"; resolves once the run has ended
//   resume  start the queue again after a run was blocked (signed out, plan limit); a successful sign-in calls it
export type Launcher = {
  wake(): void;
  cancel(runId: string): Promise<void>;
  resume(): void;
};

export type ServerContext = {
  db: Database;
  folder: PersonFolder | null;
  bus: EventBus;
  now: () => Date;
  appDataDir: string;
  resourcesDir: string;
  tracker: TrackerExporter;
  backups: Backups;
  logger: Logger;
  options: StartOptions;
  runTokens: RunTokens;
  sessionToken: string;
  port: number; // the port the server is listening on; 0 until it is bound
  launcher: Launcher | null;
  // Not in section 10's list: the resume renderer is created once (it compiles the template) and shared.
  renderer: ResumeRenderer;
};

export type ContextParts = {
  options: StartOptions;
  db: Database;
  folder: PersonFolder | null;
  logger: Logger;
  now?: () => Date;
  sessionToken?: string;
  renderer?: ResumeRenderer;
  // Tests pass a scheduler that never fires, so no backup or tracker write happens behind their back.
  scheduler?: Scheduler;
};

export function createServerContext(parts: ContextParts): ServerContext {
  const now = parts.now ?? (() => new Date());
  const logger = parts.logger;
  const bus = createEventBus((error) => logger.error({ err: error }, "An event listener failed."));
  const reportError = (what: string, error: unknown): void => logger.error({ err: error }, what);

  const ctx: ServerContext = {
    db: parts.db,
    folder: parts.folder,
    bus,
    now,
    appDataDir: parts.options.appDataDir,
    resourcesDir: parts.options.resourcesDir,
    tracker: createTrackerExporter({
      getDb: () => ctx.db,
      getFolder: () => ctx.folder,
      now,
      scheduler: parts.scheduler,
      reportError,
    }),
    backups: createBackups({
      getDb: () => ctx.db,
      getFolder: () => ctx.folder,
      now,
      scheduler: parts.scheduler,
      reportError,
      onBackupDone: (backup, reason) => {
        logger.info({ reason }, "Backed up your data.");
        bus.emit({ type: "backup.done", at: backup.createdAt });
      },
    }),
    logger,
    options: parts.options,
    runTokens: createRunTokens(),
    sessionToken: parts.sessionToken ?? createSessionToken(),
    port: 0,
    launcher: null,
    renderer:
      parts.renderer ??
      createResumeRenderer({ templatesDir: path.join(parts.options.resourcesDir, "packages", "render", "templates") }),
  };
  return ctx;
}
