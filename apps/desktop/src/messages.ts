// The messages main and the server send each other over the utilityProcess channel.
// Anything arriving from the server is checked here before main acts on it.
// Spec: ARCHITECTURE.md section 11 (server entry) and section 13.

// Server -> main, once, when the server is listening.
export type ReadyMessage = { type: "ready"; port: number; sessionToken: string };

// Server -> main, when the person asks to open a file or folder (POST /api/open).
// `personFolder` is the folder the person chose; main opens the path only when it is inside it.
// It is null when the server did not send one, and main then refuses (fail closed).
export type OpenPathMessage = { type: "open-path"; path: string; personFolder: string | null };

export type ServerMessage = ReadyMessage | OpenPathMessage;

// Main -> server, once, when the person chooses Quit.
export type ShutdownMessage = { type: "shutdown" };
export const SHUTDOWN_MESSAGE: ShutdownMessage = { type: "shutdown" };

const MAX_PORT = 65535;

export function parseServerMessage(value: unknown): ServerMessage | null {
  if (!isRecord(value)) return null;
  if (value.type === "ready") return parseReadyMessage(value);
  if (value.type === "open-path") return parseOpenPathMessage(value);
  return null;
}

function parseReadyMessage(value: Record<string, unknown>): ReadyMessage | null {
  const { port, sessionToken } = value;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > MAX_PORT) return null;
  if (typeof sessionToken !== "string" || sessionToken === "") return null;
  return { type: "ready", port, sessionToken };
}

function parseOpenPathMessage(value: Record<string, unknown>): OpenPathMessage | null {
  const { path, personFolder } = value;
  if (typeof path !== "string") return null;
  const hasPersonFolder = typeof personFolder === "string" && personFolder !== "";
  return { type: "open-path", path, personFolder: hasPersonFolder ? personFolder : null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
