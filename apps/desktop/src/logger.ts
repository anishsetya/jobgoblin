// A tiny file logger for main. On Windows electron.exe has no console, so a file is the only way
// to see what main did. Never log profile values, tokens or job text; log what happened, not the data.
// Spec: ARCHITECTURE.md section 13 (diagnostics); tech spec "Errors, logs and observability".

import fs from "node:fs";
import path from "node:path";

// The file is moved aside once at start-up when it is larger than this, so it cannot grow forever.
const MAX_LOG_BYTES = 1024 * 1024;

export type Logger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, cause?: unknown): void;
};

export function createLogger(logFilePath: string): Logger {
  prepareLogFile(logFilePath);

  function write(level: string, message: string): void {
    const line = `${new Date().toISOString()} ${level} ${message}\n`;
    try {
      fs.appendFileSync(logFilePath, line);
    } catch (writeError) {
      // The log itself is broken. The console is the last place left to say so.
      console.error(line.trimEnd(), writeError);
    }
  }

  return {
    info: (message) => write("INFO ", message),
    warn: (message) => write("WARN ", message),
    error: (message, cause) => write("ERROR", cause === undefined ? message : `${message} ${describeError(cause)}`),
  };
}

function prepareLogFile(logFilePath: string): void {
  fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
  const isTooLarge = fs.existsSync(logFilePath) && fs.statSync(logFilePath).size > MAX_LOG_BYTES;
  if (isTooLarge) fs.renameSync(logFilePath, `${logFilePath}.1`);
}

function describeError(cause: unknown): string {
  if (cause instanceof Error) return cause.stack ?? cause.message;
  return String(cause);
}
