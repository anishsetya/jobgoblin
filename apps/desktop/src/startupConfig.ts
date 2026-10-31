// Everything main decides before it starts anything: which folders to use, where the server
// bundle is, and the environment the server gets. Pure, so tests can check it without Electron.
// Spec: ARCHITECTURE.md decisions D2 (resourcesDir) and section 13.

import path from "node:path";

const APP_DATA_FOLDER_NAME = "Jobgoblin";

// Relative to resourcesDir. The server agent's build writes the bundle here.
const SERVER_BUNDLE_RELATIVE_PATH = path.join("packages", "server", "dist", "server.mjs");

export type StartupConfig = {
  appDataDir: string;
  // Chromium keeps its own cache and local storage here. Inside appDataDir so a test that
  // sets JOBGOBLIN_APP_DATA is fully separate from the real app, including the single-instance lock.
  electronDataDir: string;
  logFilePath: string;
  resourcesDir: string;
  serverBundlePath: string;
  serverEnvironment: NodeJS.ProcessEnv;
};

export type StartupConfigInput = {
  env: NodeJS.ProcessEnv;
  // Electron's app.getPath("appData"): %APPDATA% on Windows, ~/Library/Application Support on macOS.
  systemAppDataDir: string;
  // Electron's app.getAppPath(): apps/desktop when running from source.
  appPath: string;
};

export function resolveStartupConfig(input: StartupConfigInput): StartupConfig {
  const appDataDir = resolveAppDataDir(input);
  const resourcesDir = resolveResourcesDir(input);

  return {
    appDataDir,
    electronDataDir: path.join(appDataDir, "electron"),
    logFilePath: path.join(appDataDir, "logs", "desktop.log"),
    resourcesDir,
    serverBundlePath: path.join(resourcesDir, SERVER_BUNDLE_RELATIVE_PATH),
    serverEnvironment: buildServerEnvironment(input.env, appDataDir, resourcesDir),
  };
}

function resolveAppDataDir(input: StartupConfigInput): string {
  const override = readEnvironmentValue(input.env, "JOBGOBLIN_APP_DATA");
  if (override !== undefined) return path.resolve(override);
  return path.join(input.systemAppDataDir, APP_DATA_FOLDER_NAME);
}

// From source the resources (migrations, templates, playbooks, dashboard build) are the repository
// root, two levels above apps/desktop. Packaged builds are outside the developer preview.
function resolveResourcesDir(input: StartupConfigInput): string {
  const override = readEnvironmentValue(input.env, "JOBGOBLIN_RESOURCES_DIR");
  if (override !== undefined) return path.resolve(override);
  return path.resolve(input.appPath, "..", "..");
}

// The server inherits the whole environment: it needs PATH to find `claude` and the user folders to
// find its settings. The two folder variables are set last so nothing outside can redirect them.
// The optional JOBGOBLIN_* settings (JOBGOBLIN_CLAUDE_COMMAND, JOBGOBLIN_CLAUDE_INSTALL_COMMAND,
// JOBGOBLIN_FEED_FIXTURES, JOBGOBLIN_PORT, JOBGOBLIN_DEV_ORIGIN) reach the server through this copy
// when they are set.
function buildServerEnvironment(env: NodeJS.ProcessEnv, appDataDir: string, resourcesDir: string): NodeJS.ProcessEnv {
  return { ...env, JOBGOBLIN_APP_DATA: appDataDir, JOBGOBLIN_RESOURCES_DIR: resourcesDir };
}

// An empty variable counts as not set.
function readEnvironmentValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === "" ? undefined : value;
}
