// The rules for what main is willing to open on the person's behalf: web links and files.
// Pure checks with no Electron import, so they are easy to test and easy to audit.
// Spec: ARCHITECTURE.md section 13 (will-navigate, setWindowOpenHandler, open-path).

import fs from "node:fs/promises";
import path from "node:path";

// Stops a page from handing the operating system a `file:`, `smb:` or custom-protocol link.
export function isHttpUrl(url: string): boolean {
  const protocol = parseUrl(url)?.protocol;
  return protocol === "http:" || protocol === "https:";
}

// Stops the dashboard window from ever showing a page that is not the Jobgoblin server.
export function isSameOrigin(url: string, origin: string): boolean {
  return parseUrl(url)?.origin === origin;
}

// Returns the real location of `candidate` when it is the folder itself or something inside it,
// otherwise null. Stops a request to open `..\..\Windows\notepad.exe` or a link inside the folder
// that points outside it: both sides are resolved through links before they are compared.
export async function findPathInsideFolder(candidate: string, folder: string): Promise<string | null> {
  if (!path.isAbsolute(candidate) || !path.isAbsolute(folder)) return null;

  try {
    const realCandidate = await fs.realpath(candidate);
    const realFolder = await fs.realpath(folder);
    return isInside(realCandidate, realFolder) ? realCandidate : null;
  } catch {
    // A path that does not exist cannot be opened, so it counts as not inside.
    return null;
  }
}

function isInside(candidate: string, folder: string): boolean {
  const relative = path.relative(folder, candidate);
  if (relative === "") return true;
  const goesUp = relative === ".." || relative.startsWith(`..${path.sep}`);
  // On Windows a path on another drive comes back absolute.
  return !goesUp && !path.isAbsolute(relative);
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
