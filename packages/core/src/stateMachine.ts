// The application state machine: the only place that decides which status moves are allowed.
// The server refuses any move that is not in TRANSITIONS. Each move names who may make it (the actor) and
// by which action (the via, decision D16), so the generic "change status" route can never reach Applied or
// Approved: those moves have their own vias ("submitted", "approve") that only their own service uses.
// Spec: "Application state machine". ARCHITECTURE.md sections 6 and 6.1.
import { ApplicationStatus } from "@jobgoblin/schemas";
import type { Actor, HistoryEvent, TransitionVia } from "@jobgoblin/schemas";
import { CoreError } from "./errors";

export type Transition = {
  from: ApplicationStatus | null; // null: the application does not exist yet
  to: ApplicationStatus;
  actors: readonly Actor[];
  via: TransitionVia;
};

// A row as the spec writes it: it may list several statuses on either side ("Scored, Long shot -> Tailored").
type SpecRow = {
  from: readonly (ApplicationStatus | null)[];
  to: readonly ApplicationStatus[];
  actors: readonly Actor[];
  via: TransitionVia;
};

// Everything that is still being pursued. Skipped applications are already closed, so they are left out:
// the person uses Undo skip first, then withdraws.
const OPEN_STATUSES: readonly ApplicationStatus[] = [
  "Found", "Scored", "Long shot", "Tailored", "Awaiting approval", "Approved", "Filling", "Needs your input",
  "Applied", "OA", "Phone screen", "Onsite", "Offer",
];

// The table of section 6.1, one line per spec row, in the spec's order.
const SPEC_ROWS: readonly SpecRow[] = [
  // A new application starts in Found: a run's record_fit creates it, or the server does for a pasted job.
  { from: [null], to: ["Found"], actors: ["run", "server"], via: "record_fit" },
  { from: [null], to: ["Found"], actors: ["server"], via: "server" },

  // Scoring.
  { from: ["Found"], to: ["Scored"], actors: ["run"], via: "record_fit" },
  { from: ["Scored"], to: ["Skipped (low fit)", "Long shot"], actors: ["server"], via: "record_fit" },

  // Tailoring. A Long shot is tailored only after the person clicks Tailor; the service checks that.
  { from: ["Scored", "Long shot"], to: ["Tailored"], actors: ["run"], via: "submit_resume_draft" },
  { from: ["Tailored"], to: ["Awaiting approval"], actors: ["server"], via: "submit_resume_draft" },
  { from: ["Awaiting approval"], to: ["Tailored"], actors: ["person"], via: "request_edit" },

  // The person's decisions on the Review screen. A scored job can also be dismissed before it is tailored.
  { from: ["Scored", "Awaiting approval"], to: ["Skipped"], actors: ["person"], via: "skip" },
  { from: ["Awaiting approval"], to: ["Approved"], actors: ["person"], via: "approve" },

  // Filling the form. The autofill extension is not in the proof of concept, but the table is complete.
  { from: ["Approved"], to: ["Filling"], actors: ["extension"], via: "extension" },
  { from: ["Filling"], to: ["Needs your input"], actors: ["extension"], via: "extension" },
  { from: ["Needs your input"], to: ["Filling"], actors: ["person"], via: "extension" },

  // Applied needs proof, so only the "submitted" service can make this move.
  { from: ["Approved", "Filling"], to: ["Applied"], actors: ["person", "extension"], via: "submitted" },

  // After applying, the person records what happens. Only a run (later) may also record a first reply.
  { from: ["Applied"], to: ["OA", "Phone screen", "Onsite"], actors: ["person", "run"], via: "status" },
  { from: ["OA"], to: ["Phone screen", "Onsite"], actors: ["person"], via: "status" },
  { from: ["Phone screen"], to: ["Onsite"], actors: ["person"], via: "status" },
  { from: ["Onsite"], to: ["Offer"], actors: ["person"], via: "status" },
  // The server may suggest Ghosted, but the person makes the move.
  { from: ["Applied", "OA", "Phone screen", "Onsite"], to: ["Rejected", "Ghosted"], actors: ["person"], via: "status" },
  { from: ["Offer"], to: ["Accepted", "Declined"], actors: ["person"], via: "status" },

  // Withdrawing is the person's decision, from any open status.
  { from: OPEN_STATUSES, to: ["Withdrawn"], actors: ["person"], via: "withdraw" },

  // Undo skip returns to "the status before the skip". Which one is a fact of the history, so the table
  // lists every status a skip can start from, and statusBeforeSkip picks the right one.
  { from: ["Skipped (low fit)"], to: ["Scored"], actors: ["person"], via: "undo_skip" },
  { from: ["Skipped"], to: ["Scored", "Awaiting approval"], actors: ["person"], via: "undo_skip" },
];

// One Transition per (from, to) pair, which is what the checks below look up.
function expandRows(rows: readonly SpecRow[]): Transition[] {
  const transitions: Transition[] = [];
  for (const row of rows) {
    for (const from of row.from) {
      for (const to of row.to) {
        transitions.push({ from, to, actors: row.actors, via: row.via });
      }
    }
  }
  return transitions;
}

export const TRANSITIONS: readonly Transition[] = expandRows(SPEC_ROWS);

export function canTransition(
  from: ApplicationStatus | null,
  to: ApplicationStatus,
  actor: Actor,
  via: TransitionVia,
): boolean {
  return TRANSITIONS.some(
    (row) => row.from === from && row.to === to && row.via === via && row.actors.includes(actor),
  );
}

// Throws when the move is not in the table. Services call this before they change any status, so a
// forbidden move is a bug or an attempt to cheat, never something the person sees.
export function assertTransition(
  from: ApplicationStatus | null,
  to: ApplicationStatus,
  actor: Actor,
  via: TransitionVia,
): void {
  if (canTransition(from, to, actor, via)) return;
  const start = from === null ? "a new application" : `"${from}"`;
  throw new CoreError(
    "invalid-transition",
    `The ${actor} cannot move ${start} to "${to}" by "${via}". That move is not in the state machine.`,
  );
}

// The statuses this actor can move an application to from `from`, by this action. The Application screen
// offers exactly these in its status menu (actor person, via status).
export function allowedMoves(
  from: ApplicationStatus | null,
  actor: Actor,
  via: TransitionVia,
): ApplicationStatus[] {
  const targets: ApplicationStatus[] = [];
  for (const row of TRANSITIONS) {
    const isMatch = row.from === from && row.via === via && row.actors.includes(actor);
    if (isMatch && !targets.includes(row.to)) targets.push(row.to);
  }
  return targets;
}

const SKIP_STATUSES: readonly string[] = ["Skipped", "Skipped (low fit)"];

// The status an application had just before its latest skip, for Undo skip. Returns null when the history
// holds no skip. Events are ordered by time, so the list may arrive oldest first or newest first;
// events with the same time keep the order they were given in (oldest first).
export function statusBeforeSkip(history: readonly HistoryEvent[]): ApplicationStatus | null {
  const skips = history.filter(
    (event) => event.type === "status-changed" && event.to !== null && SKIP_STATUSES.includes(event.to),
  );
  const oldestFirst = [...skips].sort((a, b) => compareText(a.ts, b.ts));
  const latestSkip = oldestFirst.at(-1);
  if (latestSkip === undefined) return null;

  const parsed = ApplicationStatus.safeParse(latestSkip.from);
  return parsed.success ? parsed.data : null;
}

// ISO timestamps in one format sort correctly as plain text.
function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
