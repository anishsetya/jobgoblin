// The two things the dashboard can ask main for: the session token (answered only to the server's
// own pages) and a native folder picker. The sender check uses the origin of the frame as the browser
// process sees it, which a page cannot fake.
// Spec: ARCHITECTURE.md decision D4 and section 13.

import { BrowserWindow, app, dialog, ipcMain, type OpenDialogOptions, type WebFrameMain } from "electron";
import { IPC_CHANNELS } from "./channels";
import type { Logger } from "./logger";

export type IpcOptions = {
  serverOrigin: string;
  sessionToken: string;
  logger: Logger;
};

export function registerIpcHandlers(options: IpcOptions): void {
  const { serverOrigin, sessionToken, logger } = options;

  // Synchronous (ipcMain.on, not handle): the preload must have the token before the page's scripts run.
  // Always sets returnValue; a synchronous message that is never answered would freeze the page.
  ipcMain.on(IPC_CHANNELS.getSessionToken, (event) => {
    const frame = event.senderFrame;
    const isAllowed = isFromServerOrigin(frame, serverOrigin);
    // A new window runs its preload once on an empty page (origin "null") before the real page loads.
    // That is normal, so only a real foreign origin is worth a warning.
    if (!isAllowed && frame?.origin !== "null") {
      logger.warn(`Refused to give the session token to the origin ${frame?.origin ?? "(frame gone)"}.`);
    }
    event.returnValue = isAllowed ? sessionToken : null;
  });

  ipcMain.handle(IPC_CHANNELS.chooseFolder, (event) => {
    if (!isFromServerOrigin(event.senderFrame, serverOrigin)) {
      logger.warn("Refused to show the folder picker to a page that is not the dashboard.");
      throw new Error("Only the Jobgoblin dashboard can choose a folder.");
    }
    return showFolderPicker(BrowserWindow.fromWebContents(event.sender));
  });
}

// Threat: another page getting the token or opening dialogs. `senderFrame` is null when the frame
// is already gone, which also counts as not allowed.
function isFromServerOrigin(frame: WebFrameMain | null, serverOrigin: string): boolean {
  return frame !== null && frame.origin === serverOrigin;
}

// Resolves to the chosen folder, or null when the person cancels.
async function showFolderPicker(parent: BrowserWindow | null): Promise<string | null> {
  const dialogOptions: OpenDialogOptions = {
    title: "Choose your Jobgoblin folder",
    defaultPath: app.getPath("documents"),
    properties: ["openDirectory", "createDirectory"],
  };
  const result = parent ? await dialog.showOpenDialog(parent, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}
