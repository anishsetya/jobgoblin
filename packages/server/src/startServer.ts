// Starts the whole server: opens the database, checks the approved files, builds the context, binds
// 127.0.0.1, writes server.json, and returns a handle to stop it. Both main.ts (the real program) and the
// tests start the server through this one function.
// Spec: ARCHITECTURE.md sections 7 (startup checks), 11 (server entry), decision D14, and tech spec "Processes and startup".
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { createAdaptorServer } from "@hono/node-server";
import {
  createPersonFolder,
  getSetting,
  verifyApprovedFiles,
  type Database,
  type PersonFolder,
} from "@jobgoblin/storage";
import packageInfo from "../package.json";
import { createServerContext, type ServerContext, type StartOptions } from "./context";
import { createApp } from "./http/app";
import { BIND_ADDRESS, listenOnFreePort } from "./http/listen";
import { createLogger, type Logger } from "./logger";
import { startRunner } from "./runner/startRunner";
import { seedCompaniesIfEmpty } from "./services/feeds";
import { cancelRunsForShutdown } from "./services/runShutdown";
import { openServerDatabase } from "./services/serverDatabase";

export const SERVER_JSON_FILE_NAME = "server.json";
const DAILY_BACKUP_CHECK_EVERY_MS = 60 * 60 * 1000;

export type RunningServer = {
  port: number;
  sessionToken: string;
  url: string; // the address to open in a browser, with the token in the fragment (decision D4)
  ctx: ServerContext;
  stop(): Promise<void>;
};

export async function startServer(options: StartOptions): Promise<RunningServer> {
  fs.mkdirSync(options.appDataDir, { recursive: true });
  const logger = createLogger(options.appDataDir);

  const db = openServerDatabase({ appDataDir: options.appDataDir, resourcesDir: options.resourcesDir, now: () => new Date() });
  const ctx = createServerContext({ options, db, folder: openSavedFolder(db, logger), logger });

  seedCompaniesIfEmpty(ctx);
  checkApprovedFiles(ctx);

  // Before the server listens, so a run queued by the very first request is picked up.
  await startRunner(ctx);

  const server = createAdaptorServer({ fetch: createApp(ctx).fetch }) as Server;
  ctx.port = await listenOnFreePort(server, options.port);
  const serverJsonPath = writeServerJson(ctx);
  const dailyBackupTimer = startDailyBackupCheck(ctx);
  // Runs queued before the last quit start now, when their mcp.json can name the real port.
  ctx.launcher?.wake();

  logger.info({ port: ctx.port }, "Jobgoblin's server is ready.");
  return {
    port: ctx.port,
    sessionToken: ctx.sessionToken,
    url: `http://127.0.0.1:${ctx.port}/#token=${ctx.sessionToken}`,
    ctx,
    stop: createStopper({ ctx, server, dailyBackupTimer, serverJsonPath }),
  };
}

// ---------------------------------------------------------------------------------------------
// Start-up steps
// ---------------------------------------------------------------------------------------------

// The folder the person chose earlier. If it cannot be used now (an unplugged drive, say), the server still
// starts, with no folder, and Settings asks the person to choose one.
function openSavedFolder(db: Database, logger: Logger): PersonFolder | null {
  const savedPath = getSetting(db, "personFolder");
  if (savedPath === null) return null;
  try {
    const folder = createPersonFolder(savedPath);
    folder.ensureLayout();
    return folder;
  } catch (error) {
    logger.warn({ err: error }, "The Jobgoblin folder could not be opened, so the server starts without it.");
    return null;
  }
}

// Every approved resume file must still exist (decision D19): a missing one is written again from the database.
function checkApprovedFiles(ctx: ServerContext): void {
  if (ctx.folder === null) return;
  try {
    const report = verifyApprovedFiles(ctx.db, ctx.folder);
    ctx.logger.info(
      { checked: report.checked, rewritten: report.rewritten.length, mismatched: report.mismatched.length, refused: report.refused.length },
      "Checked approved resume files.",
    );
  } catch (error) {
    ctx.logger.error({ err: error }, "The approved resume files could not be checked.");
  }
}

// server.json says where the server is (no secrets), so a tool can find it. Removed again on stop.
function writeServerJson(ctx: ServerContext): string {
  const filePath = path.join(ctx.appDataDir, SERVER_JSON_FILE_NAME);
  const info = { port: ctx.port, pid: process.pid, version: packageInfo.version, startedAt: ctx.now().toISOString() };
  fs.writeFileSync(filePath, `${JSON.stringify(info, null, 2)}\n`);
  return filePath;
}

// A backup once a day: now if none was made today, then every hour check whether a new day has begun.
function startDailyBackupCheck(ctx: ServerContext): ReturnType<typeof setInterval> {
  const check = (): void => {
    try {
      ctx.backups.runDailyIfDue();
    } catch (error) {
      ctx.logger.error({ err: error }, "The daily backup failed.");
    }
  };
  check();
  const timer = setInterval(check, DAILY_BACKUP_CHECK_EVERY_MS);
  timer.unref();
  return timer;
}

// ---------------------------------------------------------------------------------------------
// Stopping
// ---------------------------------------------------------------------------------------------

type StopInput = {
  ctx: ServerContext;
  server: Server;
  dailyBackupTimer: ReturnType<typeof setInterval>;
  serverJsonPath: string;
};

// Quit: stop answering, cancel queued runs and stop running ones, write the tracker one last time,
// close the database and remove server.json. Calling it twice is harmless.
function createStopper(input: StopInput): () => Promise<void> {
  const { ctx } = input;
  let stopping: Promise<void> | null = null;

  async function stop(): Promise<void> {
    clearInterval(input.dailyBackupTimer);
    await closeHttpServer(input.server);
    await cancelRunsForShutdown(ctx);
    try {
      await ctx.tracker.flushNow();
    } catch (error) {
      ctx.logger.error({ err: error }, "The tracker could not be written at shutdown.");
    }
    ctx.db.close();
    fs.rmSync(input.serverJsonPath, { force: true });
    ctx.logger.info("Jobgoblin's server stopped.");
  }

  return () => {
    stopping ??= stop();
    return stopping;
  };
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    // Open event streams would keep the server from closing, so they are ended.
    server.closeAllConnections();
  });
}
