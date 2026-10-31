// The tray icon with Open Jobgoblin and Quit. Closing the window only hides it, so the tray is how
// the person gets back to it and how they really quit.
// Spec: ARCHITECTURE.md section 13 (tray).

import { Menu, Tray } from "electron";
import { createTrayIcon } from "./trayIcon";

export type TrayOptions = {
  onOpen(): void;
  onQuit(): void;
};

// The caller must keep the returned Tray: if it is garbage collected, the icon disappears.
export function createTray(options: TrayOptions): Tray {
  const tray = new Tray(createTrayIcon());
  tray.setToolTip("Jobgoblin");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Jobgoblin", click: options.onOpen },
      { type: "separator" },
      { label: "Quit", click: options.onQuit },
    ]),
  );
  // On Windows a left click opens the window; a right click shows the menu.
  tray.on("click", options.onOpen);
  return tray;
}
