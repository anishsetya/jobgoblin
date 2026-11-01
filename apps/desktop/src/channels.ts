// The names of the IPC channels between the dashboard window (preload) and main.
// Both sides import this one file, so a typo cannot silently break a channel.
// Spec: ARCHITECTURE.md section 13.

export const IPC_CHANNELS = {
  // Synchronous: the preload needs the session token before the page's own scripts run.
  getSessionToken: "jobgoblin:get-session-token",
  chooseFolder: "jobgoblin:choose-folder",
} as const;
