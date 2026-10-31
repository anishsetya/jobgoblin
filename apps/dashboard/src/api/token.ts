// Finds the session key the dashboard must send with every request, and keeps it out of the address bar.
// Where it comes from, in order: the desktop app's preload script, then this tab's session storage,
// which is filled from the "#token=" part of the address the server printed (decision D4).
// A fragment is never sent to a server or written to a log, and it is removed as soon as it is read.
// Spec: ARCHITECTURE.md sections 2 (D4) and 12.
import { getDesktopBridge } from "./desktop";

const STORAGE_KEY = "jobgoblin.session";
const FRAGMENT_NAME = "token";

function readStoredToken(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage can be blocked in private windows; the fragment is then needed on every load
  }
}

function storeToken(token: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Without storage the key lives only until this page is reloaded; nothing else to do.
  }
}

let tokenFromAddress: string | null = null;

// Moves "#token=..." out of the address bar into memory and session storage.
// A fresh fragment always wins over an older stored key: after the server restarts, the person
// opens the new address and must not keep sending the old key.
function takeTokenFromAddress(): void {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const token = fragment.get(FRAGMENT_NAME);
  if (token === null || token === "") return;

  tokenFromAddress = token;
  storeToken(token);
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

// Call once, before the router starts, so the router never sees the fragment.
export function readSessionToken(): string | null {
  takeTokenFromAddress();
  return getDesktopBridge()?.sessionToken ?? tokenFromAddress ?? readStoredToken();
}
