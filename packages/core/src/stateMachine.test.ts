import { describe, expect, it } from "vitest";
import { Actor, ApplicationStatus, TransitionVia } from "@jobgoblin/schemas";
import type { HistoryEvent } from "@jobgoblin/schemas";
import { CoreError } from "./errors";
import { allowedMoves, assertTransition, canTransition, statusBeforeSkip, TRANSITIONS } from "./stateMachine";

type Move = [from: ApplicationStatus | null, to: ApplicationStatus, actor: Actor, via: TransitionVia];

// The spec's table (ARCHITECTURE.md 6.1), written out one move per line and independently of the code,
// so a change to TRANSITIONS has to be a deliberate change to this list too.
const EVERY_ALLOWED_MOVE: Move[] = [
  [null, "Found", "run", "record_fit"],
  [null, "Found", "server", "record_fit"],
  [null, "Found", "server", "server"],
  ["Found", "Scored", "run", "record_fit"],
  ["Scored", "Skipped (low fit)", "server", "record_fit"],
  ["Scored", "Long shot", "server", "record_fit"],
  ["Scored", "Tailored", "run", "submit_resume_draft"],
  ["Long shot", "Tailored", "run", "submit_resume_draft"],
  ["Tailored", "Awaiting approval", "server", "submit_resume_draft"],
  ["Awaiting approval", "Tailored", "person", "request_edit"],
  ["Awaiting approval", "Skipped", "person", "skip"],
  ["Scored", "Skipped", "person", "skip"],
  ["Awaiting approval", "Approved", "person", "approve"],
  ["Approved", "Filling", "extension", "extension"],
  ["Filling", "Needs your input", "extension", "extension"],
  ["Needs your input", "Filling", "person", "extension"],
  ["Approved", "Applied", "person", "submitted"],
  ["Approved", "Applied", "extension", "submitted"],
  ["Filling", "Applied", "person", "submitted"],
  ["Filling", "Applied", "extension", "submitted"],
  ["Applied", "OA", "person", "status"],
  ["Applied", "OA", "run", "status"],
  ["Applied", "Phone screen", "person", "status"],
  ["Applied", "Phone screen", "run", "status"],
  ["Applied", "Onsite", "person", "status"],
  ["Applied", "Onsite", "run", "status"],
  ["OA", "Phone screen", "person", "status"],
  ["OA", "Onsite", "person", "status"],
  ["Phone screen", "Onsite", "person", "status"],
  ["Onsite", "Offer", "person", "status"],
  ...(["Applied", "OA", "Phone screen", "Onsite"] as const).flatMap((from): Move[] => [
    [from, "Rejected", "person", "status"],
    [from, "Ghosted", "person", "status"],
  ]),
  ["Offer", "Accepted", "person", "status"],
  ["Offer", "Declined", "person", "status"],
  ...(
    [
      "Found", "Scored", "Long shot", "Tailored", "Awaiting approval", "Approved", "Filling", "Needs your input",
      "Applied", "OA", "Phone screen", "Onsite", "Offer",
    ] as const
  ).map((from): Move => [from, "Withdrawn", "person", "withdraw"]),
  ["Skipped (low fit)", "Scored", "person", "undo_skip"],
  ["Skipped", "Scored", "person", "undo_skip"],
  ["Skipped", "Awaiting approval", "person", "undo_skip"],
];

describe("TRANSITIONS", () => {
  it("allows exactly the moves in the spec's table", () => {
    const fromTable = TRANSITIONS.flatMap((row) => row.actors.map((actor) => [row.from, row.to, actor, row.via]));

    expect(fromTable).toHaveLength(EVERY_ALLOWED_MOVE.length);
    expect(fromTable).toEqual(expect.arrayContaining(EVERY_ALLOWED_MOVE));
  });

  it("allows every move in the spec's table, and says which move it refused", () => {
    const refused = EVERY_ALLOWED_MOVE.filter(([from, to, actor, via]) => !canTransition(from, to, actor, via));
    const thrown = EVERY_ALLOWED_MOVE.filter(([from, to, actor, via]) => {
      try {
        assertTransition(from, to, actor, via);
        return false;
      } catch {
        return true;
      }
    });

    expect(refused).toEqual([]);
    expect(thrown).toEqual([]);
  });

  it("refuses every other actor and every other via for each row", () => {
    for (const row of TRANSITIONS) {
      for (const actor of Actor.options) {
        const isListed = row.actors.includes(actor);
        expect(canTransition(row.from, row.to, actor, row.via)).toBe(isListed);
      }
      for (const via of TransitionVia.options) {
        const rowExists = TRANSITIONS.some((other) => other.from === row.from && other.to === row.to && other.via === via);
        if (!rowExists) expect(canTransition(row.from, row.to, "person", via)).toBe(false);
      }
    }
  });

  it("starts every move from a real status or from a new application", () => {
    for (const row of TRANSITIONS) {
      expect(row.from === null || ApplicationStatus.options.includes(row.from)).toBe(true);
      expect(ApplicationStatus.options).toContain(row.to);
    }
  });
});

describe("the status route", () => {
  it("can never reach Applied or Approved, whoever asks", () => {
    for (const from of [null, ...ApplicationStatus.options]) {
      for (const actor of Actor.options) {
        expect(canTransition(from, "Applied", actor, "status")).toBe(false);
        expect(canTransition(from, "Approved", actor, "status")).toBe(false);
      }
    }
  });

  it("lets the person move Applied forward to the interview rounds, a rejection or a ghosting", () => {
    expect(allowedMoves("Applied", "person", "status")).toEqual(["OA", "Phone screen", "Onsite", "Rejected", "Ghosted"]);
  });

  it("offers nothing from a closed status", () => {
    expect(allowedMoves("Rejected", "person", "status")).toEqual([]);
    expect(allowedMoves("Withdrawn", "person", "status")).toEqual([]);
  });

  it("does not let a run move an application past Applied except to the first interview round", () => {
    expect(allowedMoves("Applied", "run", "status")).toEqual(["OA", "Phone screen", "Onsite"]);
    expect(allowedMoves("OA", "run", "status")).toEqual([]);
  });
});

describe("assertTransition", () => {
  it("throws a CoreError that names the move when it is not allowed", () => {
    const attempt = () => assertTransition("Scored", "Applied", "person", "status");

    expect(attempt).toThrow(CoreError);
    expect(attempt).toThrow(/cannot move "Scored" to "Applied"/);
  });

  it("refuses to approve unless the person does it from Awaiting approval", () => {
    expect(canTransition("Awaiting approval", "Approved", "run", "approve")).toBe(false);
    expect(canTransition("Tailored", "Approved", "person", "approve")).toBe(false);
  });
});

describe("allowedMoves", () => {
  it("lists where Awaiting approval can go by each of the person's actions", () => {
    expect(allowedMoves("Awaiting approval", "person", "approve")).toEqual(["Approved"]);
    expect(allowedMoves("Awaiting approval", "person", "skip")).toEqual(["Skipped"]);
    expect(allowedMoves("Awaiting approval", "person", "request_edit")).toEqual(["Tailored"]);
  });

  it("does not offer Withdraw from a skipped application", () => {
    expect(allowedMoves("Skipped", "person", "withdraw")).toEqual([]);
  });
});

function aStatusChange(ts: string, from: string, to: string): HistoryEvent {
  return { id: `${ts}-${from}-${to}`, ts, actor: "person", applicationId: "app-1", type: "status-changed", from, to, detail: null };
}

describe("statusBeforeSkip", () => {
  it("returns the status the application had when it was skipped", () => {
    const history = [
      aStatusChange("2026-10-01T10:00:00.000Z", "Tailored", "Awaiting approval"),
      aStatusChange("2026-10-02T10:00:00.000Z", "Awaiting approval", "Skipped"),
    ];

    expect(statusBeforeSkip(history)).toBe("Awaiting approval");
  });

  it("returns Scored for a low-fit skip", () => {
    const history = [aStatusChange("2026-10-01T10:00:00.000Z", "Scored", "Skipped (low fit)")];

    expect(statusBeforeSkip(history)).toBe("Scored");
  });

  it("uses the latest skip when the application was skipped, restored and skipped again", () => {
    const history = [
      aStatusChange("2026-10-01T10:00:00.000Z", "Scored", "Skipped"),
      aStatusChange("2026-10-02T10:00:00.000Z", "Skipped", "Scored"),
      aStatusChange("2026-10-03T10:00:00.000Z", "Awaiting approval", "Skipped"),
    ];

    expect(statusBeforeSkip(history)).toBe("Awaiting approval");
  });

  it("gives the same answer when the history arrives newest first", () => {
    const history = [
      aStatusChange("2026-10-03T10:00:00.000Z", "Awaiting approval", "Skipped"),
      aStatusChange("2026-10-02T10:00:00.000Z", "Skipped", "Scored"),
      aStatusChange("2026-10-01T10:00:00.000Z", "Scored", "Skipped"),
    ];

    expect(statusBeforeSkip(history)).toBe("Awaiting approval");
  });

  it("returns null when the application was never skipped", () => {
    const history = [aStatusChange("2026-10-01T10:00:00.000Z", "Found", "Scored")];

    expect(statusBeforeSkip(history)).toBeNull();
    expect(statusBeforeSkip([])).toBeNull();
  });

  it("ignores events that are not status changes", () => {
    const note: HistoryEvent = { ...aStatusChange("2026-10-02T10:00:00.000Z", "Scored", "Skipped"), type: "note" };

    expect(statusBeforeSkip([note])).toBeNull();
  });

  it("returns a status that Undo skip is allowed to restore", () => {
    const before = statusBeforeSkip([aStatusChange("2026-10-02T10:00:00.000Z", "Awaiting approval", "Skipped")]);

    expect(before).not.toBeNull();
    expect(canTransition("Skipped", before as ApplicationStatus, "person", "undo_skip")).toBe(true);
  });
});
