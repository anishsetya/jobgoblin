import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveStartupConfig } from "./startupConfig";

const systemAppDataDir = path.resolve("/system/AppData/Roaming");
const appPath = path.resolve("/repo/apps/desktop");

describe("resolveStartupConfig", () => {
  it("uses Jobgoblin inside the system app data folder and the repository root by default", () => {
    const config = resolveStartupConfig({ env: {}, systemAppDataDir, appPath });

    expect(config.appDataDir).toBe(path.join(systemAppDataDir, "Jobgoblin"));
    expect(config.resourcesDir).toBe(path.resolve("/repo"));
    expect(config.serverBundlePath).toBe(path.resolve("/repo/packages/server/dist/server.mjs"));
    expect(config.logFilePath).toBe(path.join(systemAppDataDir, "Jobgoblin", "logs", "desktop.log"));
  });

  it("lets JOBGOBLIN_APP_DATA and JOBGOBLIN_RESOURCES_DIR override the defaults", () => {
    const env = { JOBGOBLIN_APP_DATA: path.resolve("/tmp/test-data"), JOBGOBLIN_RESOURCES_DIR: path.resolve("/tmp/resources") };

    const config = resolveStartupConfig({ env, systemAppDataDir, appPath });

    expect(config.appDataDir).toBe(path.resolve("/tmp/test-data"));
    expect(config.electronDataDir).toBe(path.join(path.resolve("/tmp/test-data"), "electron"));
    expect(config.serverBundlePath).toBe(path.join(path.resolve("/tmp/resources"), "packages", "server", "dist", "server.mjs"));
  });

  it("treats empty variables as not set", () => {
    const env = { JOBGOBLIN_APP_DATA: "", JOBGOBLIN_RESOURCES_DIR: "" };

    const config = resolveStartupConfig({ env, systemAppDataDir, appPath });

    expect(config.appDataDir).toBe(path.join(systemAppDataDir, "Jobgoblin"));
    expect(config.resourcesDir).toBe(path.resolve("/repo"));
  });

  it("gives the server both folders and passes the optional settings through", () => {
    const env = { PATH: "C:\\bin", JOBGOBLIN_CLAUDE_COMMAND: '["node","fake.mjs"]', JOBGOBLIN_PORT: "0" };

    const config = resolveStartupConfig({ env, systemAppDataDir, appPath });

    expect(config.serverEnvironment).toMatchObject({
      PATH: "C:\\bin",
      JOBGOBLIN_CLAUDE_COMMAND: '["node","fake.mjs"]',
      JOBGOBLIN_PORT: "0",
      JOBGOBLIN_APP_DATA: config.appDataDir,
      JOBGOBLIN_RESOURCES_DIR: config.resourcesDir,
    });
  });
});
