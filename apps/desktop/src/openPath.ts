// Opens a file or folder with the operating system, but only inside the person's folder.
// Main is the last gate: even if the server or the dashboard were tricked, a path outside the
// person's folder never reaches the shell. shell.openPath runs whatever program the system
// associates with the file, which is why the rule is "inside the person's folder or not at all".
// Spec: ARCHITECTURE.md section 13 ("On { type: "open-path" } it opens the path ... only when it is inside").

import { shell } from "electron";
import type { Logger } from "./logger";
import type { OpenPathMessage } from "./messages";
import { findPathInsideFolder } from "./openRules";

export async function openPathInsidePersonFolder(message: OpenPathMessage, logger: Logger): Promise<void> {
  // Without the folder there is nothing to check against, so the answer is no.
  if (message.personFolder === null) {
    logger.warn("Refused to open a path: the server did not say which folder is the person's folder.");
    return;
  }

  const realPath = await findPathInsideFolder(message.path, message.personFolder);
  if (realPath === null) {
    logger.warn("Refused to open a path that is missing or outside the person's folder.");
    return;
  }

  // Open the resolved path, not the one that was asked for, so a link swapped in after the check does not matter.
  const problem = await shell.openPath(realPath);
  if (problem === "") {
    logger.info("Opened a path inside the person's folder.");
  } else {
    logger.error(`The system could not open a path inside the person's folder: ${problem}`);
  }
}
