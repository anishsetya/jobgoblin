// The link to the Electron shell when the server runs inside its utilityProcess. Electron gives such a
// process `process.parentPort`; a plain node process does not have one. Messages are plain objects:
//   server to main:  { type: "ready", port, sessionToken }   and   { type: "open-path", path, personFolder }
//   main to server:  { type: "shutdown" }
// Spec: ARCHITECTURE.md sections 11 and 13; apps/desktop/README.md "Messages with the server".

export type DesktopPort = {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): void;
};

// Electron adds parentPort to `process`, which Node's own types do not know about.
export function getDesktopPort(): DesktopPort | null {
  const port = (process as unknown as { parentPort?: DesktopPort }).parentPort;
  return port ?? null;
}

export type DesktopMessage = { type: string };

export function isShutdownMessage(data: unknown): boolean {
  return typeof data === "object" && data !== null && (data as DesktopMessage).type === "shutdown";
}
