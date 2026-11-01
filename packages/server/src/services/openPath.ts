// "Open" a file or folder in the person's folder with the computer's own program. The server never starts
// the program itself: inside the desktop app it asks Electron's main process, which checks the path again
// and calls shell.openPath. In a plain browser session it only says where the file is.
// Threat stopped: opening (and so running) a file outside the person's folder.
// Spec: ARCHITECTURE.md section 11 (POST /api/open) and apps/desktop/README.md.
import fs from "node:fs";
import path from "node:path";
import type { OpenPathResponse } from "@jobgoblin/schemas";
import type { ServerContext } from "../context";
import { getDesktopPort, type DesktopPort } from "./desktopPort";
import { invalid, notFound, unavailable } from "./serviceError";

// `requestedPath` is absolute, or relative to the person's folder (as an application's folder is stored).
export function openPath(
  ctx: ServerContext,
  requestedPath: string,
  desktop: DesktopPort | null = getDesktopPort(),
): OpenPathResponse {
  const folder = ctx.folder;
  if (folder === null) {
    throw unavailable("no-person-folder", "Choose your Jobgoblin folder first.", "Open Settings and choose a folder.");
  }

  const absolutePath = path.resolve(folder.root, requestedPath);
  if (!folder.isInside(absolutePath)) {
    throw invalid("path-outside-folder", "Jobgoblin only opens files inside your Jobgoblin folder.", "Choose a file from that folder.");
  }
  if (!fs.existsSync(absolutePath)) throw notFound("file", "It may have been moved or deleted.");

  if (desktop === null) return { opened: false, path: absolutePath };
  desktop.postMessage({ type: "open-path", path: absolutePath, personFolder: folder.root });
  return { opened: true, path: absolutePath };
}
