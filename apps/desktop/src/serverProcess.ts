// Starts the Jobgoblin server in an Electron utilityProcess, waits until it says it is ready, and
// stops it again on Quit. Main talks to the server only through this module.
// Spec: ARCHITECTURE.md section 11 (server entry) and section 13; tech spec "Processes and startup".

import { utilityProcess, type UtilityProcess } from "electron";
import type { Logger } from "./logger";
import { SHUTDOWN_MESSAGE, parseServerMessage, type OpenPathMessage, type ReadyMessage } from "./messages";

export const SERVER_READY_TIMEOUT_MS = 20_000;
export const SERVER_SHUTDOWN_TIMEOUT_MS = 10_000;
// After the kill, how long to wait for the operating system to confirm the process is gone.
const SERVER_KILL_WAIT_MS = 2_000;

export type StartServerOptions = {
  bundlePath: string;
  environment: NodeJS.ProcessEnv;
  logger: Logger;
  onOpenPath(message: OpenPathMessage): void;
  // Called when the server dies without being asked to stop.
  onUnexpectedExit(exitCode: number): void;
};

export type RunningServer = {
  port: number;
  origin: string;
  sessionToken: string;
  // Asks the server to shut down, and kills it when it has not exited after 10 seconds.
  stop(): Promise<void>;
};

export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const { logger } = options;

  const child = utilityProcess.fork(options.bundlePath, [], {
    env: options.environment,
    serviceName: "Jobgoblin server",
    stdio: "pipe",
  });
  copyOutputToLog(child, logger);
  const exited = new Promise<number>((resolve) => child.once("exit", resolve));

  let ready: ReadyMessage;
  try {
    ready = await waitForReadyMessage(child, exited, options.onOpenPath, logger);
  } catch (error) {
    child.kill();
    throw error;
  }
  logger.info(`Server is ready on port ${ready.port}.`);

  let hasExited = false;
  let stopping: Promise<void> | null = null;
  void exited.then((exitCode) => {
    hasExited = true;
    logger.info(`Server exited with code ${exitCode}.`);
    if (stopping === null) options.onUnexpectedExit(exitCode);
  });

  return {
    port: ready.port,
    origin: `http://127.0.0.1:${ready.port}`,
    sessionToken: ready.sessionToken,
    stop: () => {
      stopping ??= hasExited ? Promise.resolve() : shutDownServer(child, exited, logger);
      return stopping;
    },
  };
}

// Resolves with the first valid `ready` message. Fails when the server exits first or stays silent.
// Later messages (open-path) go to `onOpenPath`; the same listener keeps serving them after ready.
function waitForReadyMessage(
  child: UtilityProcess,
  exited: Promise<number>,
  onOpenPath: (message: OpenPathMessage) => void,
  logger: Logger,
): Promise<ReadyMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Jobgoblin's background service did not start within ${SERVER_READY_TIMEOUT_MS / 1000} seconds.`));
    }, SERVER_READY_TIMEOUT_MS);

    child.on("message", (raw: unknown) => {
      const message = parseServerMessage(raw);
      if (message === null) {
        logger.warn("Ignored a message from the server that main does not understand.");
      } else if (message.type === "ready") {
        clearTimeout(timer);
        resolve(message);
      } else {
        onOpenPath(message);
      }
    });

    void exited.then((exitCode) => {
      clearTimeout(timer);
      reject(new Error(`Jobgoblin's background service stopped while starting (exit code ${exitCode}).`));
    });
  });
}

async function shutDownServer(child: UtilityProcess, exited: Promise<number>, logger: Logger): Promise<void> {
  child.postMessage(SHUTDOWN_MESSAGE);
  if (await exitedWithin(exited, SERVER_SHUTDOWN_TIMEOUT_MS)) return;

  logger.error(`The server did not exit within ${SERVER_SHUTDOWN_TIMEOUT_MS / 1000} seconds, so it is being killed.`);
  child.kill();
  await exitedWithin(exited, SERVER_KILL_WAIT_MS);
}

async function exitedWithin(exited: Promise<number>, milliseconds: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), milliseconds);
  });
  const hasExited = await Promise.race([exited.then(() => true as const), timeout]);
  clearTimeout(timer);
  return hasExited;
}

// The pipes must be read, or the server would block once they fill up. The server prints nothing
// secret (ARCHITECTURE.md section 11), so its output can go to the log as it is.
function copyOutputToLog(child: UtilityProcess, logger: Logger): void {
  child.stdout?.on("data", (chunk: unknown) => logOutput("stdout", chunk, logger));
  child.stderr?.on("data", (chunk: unknown) => logOutput("stderr", chunk, logger));
}

function logOutput(streamName: string, chunk: unknown, logger: Logger): void {
  for (const line of String(chunk).split(/\r?\n/)) {
    if (line.trim() !== "") logger.info(`server ${streamName}: ${line}`);
  }
}
