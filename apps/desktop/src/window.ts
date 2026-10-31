// The dashboard window: a locked-down BrowserWindow that shows only the Jobgoblin server's pages.
// Closing it hides it (runs keep going from the tray); only Quit really closes it.
// Spec: ARCHITECTURE.md section 13; tech spec "Security and privacy" (Electron sandbox and context isolation).

import { BrowserWindow, shell, type WebContents } from "electron";
import type { Logger } from "./logger";
import { isHttpUrl, isSameOrigin } from "./openRules";

const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 860;
const WINDOW_MIN_WIDTH = 900;
const WINDOW_MIN_HEIGHT = 600;

export type MainWindowOptions = {
  serverOrigin: string;
  preloadPath: string;
  isQuitting(): boolean;
  logger: Logger;
};

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    title: "Jobgoblin",
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    autoHideMenuBar: true,
    // Shown once the first page is drawn, so there is no blank white flash.
    show: false,
    webPreferences: {
      preload: options.preloadPath,
      // The page cannot reach Electron or Node: the preload is the only bridge, and it exposes three things.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  keepToServerOrigin(window.webContents, options.serverOrigin, options.logger);
  hideInsteadOfClosing(window, options.isQuitting);
  window.once("ready-to-show", () => window.show());

  window.loadURL(`${options.serverOrigin}/`).catch((error: unknown) => {
    options.logger.error("The dashboard did not load.", error);
    window.show(); // An invisible window would look like a hung app.
  });
  return window;
}

export function showWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

// Threat: a link or script sends the window to another site, which would then sit next to the
// session token. The window therefore never leaves the server's origin; web links go to the
// person's own browser instead.
function keepToServerOrigin(contents: WebContents, serverOrigin: string, logger: Logger): void {
  // A click or script wants to leave the page.
  contents.on("will-navigate", (event) => {
    if (isSameOrigin(event.url, serverOrigin)) return;
    event.preventDefault();
    openInBrowser(event.url, logger);
  });

  // The server answered a navigation with a redirect to somewhere else.
  contents.on("will-redirect", (event) => {
    if (isSameOrigin(event.url, serverOrigin)) return;
    event.preventDefault();
    logger.warn("Blocked a redirect away from the dashboard.");
  });

  // window.open and target="_blank": never a new Electron window, only the person's browser.
  contents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url, logger);
    return { action: "deny" };
  });
}

function openInBrowser(url: string, logger: Logger): void {
  // Only http(s): `file:` or a custom protocol would let a page start other programs.
  if (!isHttpUrl(url)) {
    logger.warn("Refused to open a link that is not http or https.");
    return;
  }
  shell.openExternal(url).catch((error: unknown) => logger.error("The browser did not open a link.", error));
}

function hideInsteadOfClosing(window: BrowserWindow, isQuitting: () => boolean): void {
  window.on("close", (event) => {
    if (isQuitting()) return;
    event.preventDefault();
    window.hide();
  });
}
