// Two small things the tracker and the backups share: a timer that tests can replace, and a place to send
// errors that happen in the background, where no caller is waiting to catch them.
// Spec: the code style guide ("Pass dependencies in as arguments"; "Never swallow an error silently").

export type ScheduledTimer = { cancel(): void };

// Runs `callback` once after `delayMs`. Tests pass a fake that records the delay and runs the callback on demand.
export type Scheduler = (callback: () => void, delayMs: number) => ScheduledTimer;

export const realScheduler: Scheduler = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  // A tracker export or backup that has not run yet must never keep the app from quitting.
  timer.unref();
  return { cancel: () => clearTimeout(timer) };
};

// Called when something fails in the background (a timer fired and the work threw). `what` says in plain
// words what was being done. The server passes its logger; the default writes to the console.
export type ReportError = (what: string, error: unknown) => void;

export const reportErrorToConsole: ReportError = (what, error) => {
  console.error(`[storage] ${what}`, error);
};
