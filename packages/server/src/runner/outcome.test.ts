import { describe, expect, it } from "vitest";
import { classifyRunEnd, OUTCOME_MESSAGES, tasksLeftPending } from "./outcome";
import type { RunEndFacts } from "./outcome";
import type { ResultEvent } from "./streamJson";

function aResult(overrides: Partial<ResultEvent> = {}): ResultEvent {
  return { kind: "result", subtype: "success", isError: false, resultText: "All done.", numTurns: 5, sessionId: "s1", ...overrides };
}

function facts(overrides: Partial<RunEndFacts> = {}): RunEndFacts {
  return { exitCode: 0, result: aResult(), timedOut: false, cancelled: false, tasks: [], ...overrides };
}

describe("classifyRunEnd", () => {
  it("is done when the run succeeded and has no tasks", () => {
    expect(classifyRunEnd(facts())).toEqual({ status: "done", outcomeMessage: OUTCOME_MESSAGES.done });
  });

  it("is done when every task is done or failed", () => {
    const tasks = [{ state: "done" }, { state: "failed" }] as const;

    expect(classifyRunEnd(facts({ tasks })).status).toBe("done");
  });

  it("is waiting when the run succeeded and a task is waiting for the person's answer", () => {
    const tasks = [{ state: "done" }, { state: "waiting" }] as const;

    expect(classifyRunEnd(facts({ tasks }))).toEqual({ status: "waiting", outcomeMessage: OUTCOME_MESSAGES.waiting });
  });

  it("counts a task left pending as failed, so a pending task alone does not make the run wait", () => {
    expect(classifyRunEnd(facts({ tasks: [{ state: "pending" }, { state: "done" }] })).status).toBe("done");
    expect(classifyRunEnd(facts({ tasks: [{ state: "pending" }, { state: "waiting" }] })).status).toBe("waiting");
  });

  it("is cancelled when the person cancelled, whatever else happened", () => {
    const cancelled = facts({ cancelled: true, timedOut: true, result: null, exitCode: 1 });

    expect(classifyRunEnd(cancelled)).toEqual({ status: "cancelled", outcomeMessage: OUTCOME_MESSAGES.cancelled });
  });

  it("is failed with 'stopped before finishing' when the run timed out", () => {
    const end = classifyRunEnd(facts({ timedOut: true, result: null, exitCode: null }));

    expect(end).toEqual({ status: "failed", outcomeMessage: "This run stopped before finishing" });
  });

  it("is failed even if a success result was printed before the timeout stopped the process", () => {
    expect(classifyRunEnd(facts({ timedOut: true })).status).toBe("failed");
  });

  it("is failed with 'stopped before finishing' when the run ran out of turns", () => {
    const result = aResult({ subtype: "error_max_turns", isError: true, resultText: "" });

    expect(classifyRunEnd(facts({ result, exitCode: 1 }))).toEqual({
      status: "failed",
      outcomeMessage: "This run stopped before finishing",
    });
  });

  it("is blocked, with the reset time, when the plan's usage limit is reached", () => {
    const result = aResult({ isError: true, resultText: "Claude AI usage limit reached|1760000000" });

    expect(classifyRunEnd(facts({ result, exitCode: 1 }))).toEqual({
      status: "blocked",
      outcomeMessage: "Your Claude plan limit is reached",
      resetsAt: "2025-10-09T08:53:20.000Z",
    });
  });

  it("is blocked without a reset time when the usage limit message has none", () => {
    const result = aResult({ isError: true, resultText: "You have hit your usage limit." });

    const end = classifyRunEnd(facts({ result }));

    expect(end).toEqual({ status: "blocked", outcomeMessage: "Your Claude plan limit is reached" });
  });

  it("reads a reset time given in milliseconds", () => {
    const result = aResult({ isError: true, resultText: "Claude usage limit reached|1760000000000" });

    expect(classifyRunEnd(facts({ result })).resetsAt).toBe("2025-10-09T08:53:20.000Z");
  });

  it.each(["Not logged in · Please run /login", "Invalid authentication credentials", "Please log in again"])(
    "is blocked with 'Sign in with Claude again' for the message %j",
    (resultText) => {
      const result = aResult({ isError: true, resultText });

      expect(classifyRunEnd(facts({ result, exitCode: 1 }))).toEqual({
        status: "blocked",
        outcomeMessage: "Sign in with Claude again",
      });
    },
  );

  it("is failed when the process ended without printing a result (a crash)", () => {
    const end = classifyRunEnd(facts({ result: null, exitCode: 1 }));

    expect(end).toEqual({ status: "failed", outcomeMessage: "This run stopped before finishing" });
  });

  it("is failed for any other error result, such as the tool server being unreachable", () => {
    const result = aResult({ subtype: "error_during_execution", isError: true, resultText: "Could not connect to the jobgoblin tool server." });

    expect(classifyRunEnd(facts({ result, exitCode: 1 })).status).toBe("failed");
  });

  it("is done when a success result was printed and the process was then killed by the system", () => {
    expect(classifyRunEnd(facts({ exitCode: null })).status).toBe("done");
  });
});

describe("tasksLeftPending", () => {
  it("returns only the tasks the run never reached", () => {
    const tasks = [
      { applicationId: "a", state: "done" as const },
      { applicationId: "b", state: "pending" as const },
      { applicationId: "c", state: "waiting" as const },
    ];

    expect(tasksLeftPending(tasks)).toEqual([{ applicationId: "b", state: "pending" }]);
  });
});
