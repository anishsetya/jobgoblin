// The 20 application statuses, who can change them, how, and the groupings built on top of them.
// This file only names the states; which moves between them are allowed lives in packages/core (TRANSITIONS).
// Spec: "Application state machine". ARCHITECTURE.md sections 5.1 and 6.1.
import { z } from "zod";

// Exactly 20 states, in the order of the spec's transition table. The database CHECK constraint
// on applications.status is written from this list, so adding a state here is a migration.
export const ApplicationStatus = z.enum([
  "Found",
  "Scored",
  "Skipped (low fit)",
  "Long shot",
  "Tailored",
  "Awaiting approval",
  "Skipped",
  "Approved",
  "Filling",
  "Needs your input",
  "Applied",
  "OA",
  "Phone screen",
  "Onsite",
  "Offer",
  "Rejected",
  "Ghosted",
  "Withdrawn",
  "Accepted",
  "Declined",
]);
export type ApplicationStatus = z.infer<typeof ApplicationStatus>;

// Who made a change. Every transition names one, and the history log records it.
export const Actor = z.enum(["person", "run", "server", "extension"]);
export type Actor = z.infer<typeof Actor>;

// The action that makes a move (decision D16). The transition table lists a "via" for every move, so the
// generic status route cannot, for example, move an application to Applied without an approval and proof:
// only "submitted" may do that, and only the submitted service uses it.
export const TransitionVia = z.enum([
  "record_fit",
  "submit_resume_draft",
  "approve",
  "submitted",
  "skip",
  "undo_skip",
  "request_edit",
  "withdraw",
  "status",
  "server",
  "extension",
]);
export type TransitionVia = z.infer<typeof TransitionVia>;

// Statuses where the application is closed. The two Skipped statuses are here even though "Undo skip"
// can reopen them, because a skipped application is not being pursued while it stays skipped.
export const TERMINAL_STATUSES: readonly ApplicationStatus[] = [
  "Skipped (low fit)",
  "Skipped",
  "Rejected",
  "Ghosted",
  "Withdrawn",
  "Declined",
  "Accepted",
];

// The statuses that count toward "3 open applications per company" (PRD T4, decision D15).
// An application counts from the moment it is tailored. Found, Scored and Long shot do not: otherwise
// four good roles at one company would block each other before any of them had a resume.
export const CAP_STATUSES: readonly ApplicationStatus[] = [
  "Tailored",
  "Awaiting approval",
  "Approved",
  "Filling",
  "Needs your input",
  "Applied",
  "OA",
  "Phone screen",
  "Onsite",
  "Offer",
];

export type StatusGroup = {
  // The English column title. The dashboard may translate it.
  name: string;
  statuses: readonly ApplicationStatus[];
};

// The columns of the Pipeline board, left to right. Each status sits in exactly one column.
// Found and Scored share the first column with the statuses that wait for the person's review,
// so "To review" is everything that has not yet been approved or closed.
export const STATUS_GROUPS: readonly StatusGroup[] = [
  { name: "To review", statuses: ["Found", "Scored", "Long shot", "Tailored", "Awaiting approval"] },
  { name: "Ready to apply", statuses: ["Approved", "Filling", "Needs your input"] },
  { name: "Applied", statuses: ["Applied"] },
  { name: "Interviewing", statuses: ["OA", "Phone screen", "Onsite"] },
  { name: "Offer", statuses: ["Offer"] },
  { name: "Closed", statuses: TERMINAL_STATUSES },
];
