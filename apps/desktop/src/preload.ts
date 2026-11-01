// The preload script: the only code in the dashboard window that can reach Electron. It gives the
// page `window.jobgoblin = { sessionToken, chooseFolder(), openPath(path) }`, and only to the server's own pages.
// Spec: ARCHITECTURE.md decision D4 and section 13.

import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "./channels";

// How the token arrives: main answers this synchronous message with the token only when the
// browser process says the asking frame belongs to the server's origin, and with null otherwise.
// That is the simplest option that is also secure:
//   - the token is not on the window's command line (other programs on the computer can read
//     command lines, which is what `additionalArguments` would use);
//   - the preload does not decide anything. A check on `location.origin` here would run in the
//     page's process, while main's check cannot be faked from there.
const sessionToken: unknown = ipcRenderer.sendSync(IPC_CHANNELS.getSessionToken);

if (typeof sessionToken === "string") {
  contextBridge.exposeInMainWorld("jobgoblin", {
    sessionToken,
    chooseFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.chooseFolder),
    openPath: (path: string): Promise<void> => openPathThroughServer(path, sessionToken),
  });
}

// The server owns the person's folder, so it makes the first decision and then asks main to open the
// path; main checks again (src/openPath.ts). Opening therefore has one route, the same one the
// dashboard uses in a plain browser. Resolves when the server accepted the request and rejects when it
// refused, so the dashboard can show the path instead. Main's own check cannot be reported back
// here (the server's message to main has no reply); a refusal there is written to desktop.log.
async function openPathThroughServer(path: string, token: string): Promise<void> {
  const response = await fetch("/api/open", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const body: unknown = response.ok ? await response.json() : null;
  const opened = typeof body === "object" && body !== null && "opened" in body && body.opened === true;
  if (!opened) throw new Error("Jobgoblin could not open this path.");
}
