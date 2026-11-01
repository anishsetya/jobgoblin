// The server's log: pino writing JSON lines to <app data>/logs/server.log, rotated at start-up when the
// file passes 10 MB (5 files kept). Profile values and the Authorization header are redacted as a second
// line of defence; the first is that code never logs them (tech spec "Errors, logs and observability").
// Tests use a silent logger.
import fs from "node:fs";
import path from "node:path";
import pino from "pino";

export type Logger = pino.Logger;

export const LOG_FILE_NAME = "server.log";
const MAX_LOG_BYTES = 10 * 1024 * 1024;
const LOG_FILES_KEPT = 5;

// Fields that could hold a person's details. A value under any of these paths is replaced, not written.
const REDACTED_PATHS = [
  "authorization",
  "headers.authorization",
  "req.headers.authorization",
  "*.headers.authorization",
  "profile",
  "*.profile",
  "contact",
  "*.contact",
  "compensation",
  "*.compensation",
  "eeo",
  "*.eeo",
  "dataSheet",
  "*.dataSheet",
  "answers",
  "*.answers",
];

export function createLogger(appDataDir: string): Logger {
  const logsDir = path.join(appDataDir, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const logPath = path.join(logsDir, LOG_FILE_NAME);
  rotateLogFiles(logPath);

  // Synchronous writes: this server logs a few lines a minute, and a synchronous write is never lost on exit.
  const destination = pino.destination({ dest: logPath, sync: true });
  return pino({ level: "info", redact: { paths: REDACTED_PATHS, censor: "[redacted]" } }, destination);
}

export function createSilentLogger(): Logger {
  return pino({ level: "silent" });
}

// server.log becomes server.log.1, server.log.1 becomes server.log.2, and so on; the oldest is deleted.
export function rotateLogFiles(logPath: string): void {
  if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= MAX_LOG_BYTES) return;

  fs.rmSync(`${logPath}.${LOG_FILES_KEPT}`, { force: true });
  for (let number = LOG_FILES_KEPT - 1; number >= 1; number -= 1) {
    const older = `${logPath}.${number}`;
    if (fs.existsSync(older)) fs.renameSync(older, `${logPath}.${number + 1}`);
  }
  fs.renameSync(logPath, `${logPath}.1`);
}
