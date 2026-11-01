// Electron main: starts the Jobgoblin server, opens the dashboard window, and lives in the tray
// until the person chooses Quit. The steps of start-up and quit are listed in order in this file.
// Spec: ARCHITECTURE.md section 13; tech spec "Processes and startup".

import fs from "node:fs";
import path from "node:path";
import { app, dialog, type BrowserWindow, type Event as ElectronEvent, type Tray } from "electron";
import { registerIpcHandlers } from "./ipc";
import { createLogger } from "./logger";
import type { OpenPathMessage } from "./messages";
import { openPathInsidePersonFolder } from "./openPath";
import { startServer, type RunningServer } from "./serverProcess";
import { resolveStartupConfig } from "./startupConfig";
import { createTray } from "./tray";
import { createMainWindow, showWindow } from "./window";

const config = resolveStartupConfig({
  env: process.env,
  systemAppDataDir: app.getPath("appData"),
  appPath: app.getAppPath(),
});
const logger = createLogger(config.logFilePath);

app.setName("Jobgoblin");
// Must happen before the single-instance lock, which is a file in this folder.
app.setPath("userData", config.electronDataDir);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let server: RunningServer | null = null;
let isQuitting = false;

void run().catch(explainStartupFailureAndExit);

async function run(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    logger.info("Jobgoblin is already running, so this second copy exits. The first one is brought forward.");
    app.quit();
    return;
  }
  app.on("second-instance", showMainWindow);
  app.on("activate", showMainWindow); // macOS: clicking the dock icon
  app.on("before-quit", stopServerThenQuit);

  await app.whenReady();
  refuseToStartWithoutServerBundle();

  server = await startServer({
    bundlePath: config.serverBundlePath,
    environment: config.serverEnvironment,
    logger,
    onOpenPath: (message) => void openPathFromServer(message),
    onUnexpectedExit: explainServerStoppedAndExit,
  });

  registerIpcHandlers({ serverOrigin: server.origin, sessionToken: server.sessionToken, logger });
  mainWindow = createMainWindow({
    serverOrigin: server.origin,
    preloadPath: path.join(__dirname, "preload.cjs"),
    isQuitting: () => isQuitting,
    logger,
  });
  tray = createTray({ onOpen: showMainWindow, onQuit: () => app.quit() });
  logger.info("Jobgoblin is running.");
}

function refuseToStartWithoutServerBundle(): void {
  if (fs.existsSync(config.serverBundlePath)) return;
  throw new Error(
    "Jobgoblin's background service has not been built yet.\n\n" +
      'Run "pnpm --filter @jobgoblin/server build", then open Jobgoblin again.\n\n' +
      `It should be at: ${config.serverBundlePath}`,
  );
}

function showMainWindow(): void {
  if (mainWindow !== null) showWindow(mainWindow);
}

function openPathFromServer(message: OpenPathMessage): Promise<void> {
  return openPathInsidePersonFolder(message, logger).catch((error: unknown) => {
    logger.error("Opening a path failed.", error);
  });
}

// Quit has two passes. The first stops the server (up to 10 seconds) while the app is still alive,
// then asks to quit again; the second pass finds `isQuitting` set and lets Electron finish.
function stopServerThenQuit(event: ElectronEvent): void {
  if (isQuitting) return;
  isQuitting = true;
  event.preventDefault();
  mainWindow?.hide();

  const serverStopped = server === null ? Promise.resolve() : server.stop();
  serverStopped
    .catch((error: unknown) => logger.error("Stopping the server failed.", error))
    .finally(() => {
      tray?.destroy();
      app.quit();
    });
}

async function explainStartupFailureAndExit(error: unknown): Promise<void> {
  logger.error("Jobgoblin could not start.", error);
  await server?.stop();
  const reason = error instanceof Error ? error.message : "Something went wrong.";
  dialog.showErrorBox(
    "Jobgoblin could not start",
    `${reason}\n\nClose Jobgoblin and open it again. If this keeps happening, the log is at:\n${config.logFilePath}`,
  );
  app.exit(1);
}

function explainServerStoppedAndExit(exitCode: number): void {
  logger.error(`The server stopped on its own (exit code ${exitCode}).`);
  dialog.showErrorBox(
    "Jobgoblin stopped",
    "Jobgoblin's background service stopped unexpectedly.\n\n" +
      "Open Jobgoblin again to continue. Anything that was running shows as interrupted, with a Retry button.\n\n" +
      `The log is at:\n${config.logFilePath}`,
  );
  app.exit(1);
}
