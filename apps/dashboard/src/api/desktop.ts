// The small bridge to the desktop app. Inside Electron the preload script adds `window.jobgoblin`
// with the session key, a native folder chooser and "open this file". In a plain browser (tests,
// development) none of that exists, so every function here has a browser fallback or says so.
// Spec: ARCHITECTURE.md sections 12 and 13.

export type DesktopBridge = {
  sessionToken: string;
  chooseFolder(): Promise<string | null>; // null when the person closes the chooser
  openPath(path: string): Promise<void>; // asks the local server to open it; rejects when refused
};

declare global {
  interface Window {
    jobgoblin?: DesktopBridge;
  }
}

export function getDesktopBridge(): DesktopBridge | null {
  return window.jobgoblin ?? null;
}

// The native folder chooser. Returns null when the person cancels, or when there is no desktop app:
// in that case the screen shows a text field for the folder path instead (see hasFolderChooser).
export async function chooseFolder(): Promise<string | null> {
  const bridge = getDesktopBridge();
  if (bridge === null) return null;
  return bridge.chooseFolder();
}

export function hasFolderChooser(): boolean {
  return getDesktopBridge() !== null;
}

// "opened": the computer opened it. "refused": the desktop app declined (the file is missing, or
// outside the person's folder). "unavailable": there is no desktop app, so the caller asks the
// local server instead (POST /api/open).
export type DesktopOpenResult = "opened" | "refused" | "unavailable";

// Asks the desktop app to open a file or folder. The bridge already calls the local server's
// POST /api/open itself, so a refusal arrives here as a rejected promise.
export async function openPathWithDesktop(path: string): Promise<DesktopOpenResult> {
  const bridge = getDesktopBridge();
  if (bridge === null) return "unavailable";
  try {
    await bridge.openPath(path);
    return "opened";
  } catch {
    return "refused";
  }
}

// Opens a job posting in the person's default browser. In Electron the main process catches the new
// window and hands the link to the operating system; in a browser it is simply a new tab.
// `noopener` stops the posting's page from reaching back into the dashboard.
export function openPostingLink(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  window.open(url, "_blank", "noopener,noreferrer");
}
