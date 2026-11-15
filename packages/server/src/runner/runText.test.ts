// The words about a run: the one next step after each way a run can stop, why a queued run waits, and one name
// per run kind that the dashboard's cards share.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../services/testSupport";
import { OUTCOME_MESSAGES } from "./outcome";
import { nextStepFor, RUN_TITLES, waitingStep } from "./runText";

describe("nextStepFor", () => {
  it.each([
    ["blocked", OUTCOME_MESSAGES.notInstalled, "open-settings"],
    ["blocked", OUTCOME_MESSAGES.updateNeeded, "open-settings"],
    ["blocked", OUTCOME_MESSAGES.signedOut, "open-settings"],
    ["blocked", `${OUTCOME_MESSAGES.usageLimit}. It resets at 10:00 PM.`, "try-again"],
    ["blocked", OUTCOME_MESSAGES.usageLimit, "try-again"],
    ["failed", OUTCOME_MESSAGES.stopped, "try-again"],
    ["failed", OUTCOME_MESSAGES.stoppedForSafety, "try-again"],
    ["interrupted", "This run was interrupted", "try-again"],
  ] as const)("a %s run that says %j needs %s", (status, outcomeMessage, nextStep) => {
    expect(nextStepFor({ status, outcomeMessage })).toBe(nextStep);
  });
});

describe("waitingStep", () => {
  it("names the run that holds the queue, why it stopped, and that trying it again lets the queue go on", () => {
    const blocked = { kind: "hunt", status: "blocked", outcomeMessage: "Your Claude plan limit is reached. It resets at 10:00 PM." } as const;

    expect(waitingStep(blocked)).toBe(
      "Waiting for Finding jobs, which stopped: Your Claude plan limit is reached. It resets at 10:00 PM. Try that run again to go on.",
    );
  });

  it("points to Settings when Claude Code itself is the problem", () => {
    const blocked = { kind: "paste", status: "blocked", outcomeMessage: OUTCOME_MESSAGES.signedOut } as const;

    expect(waitingStep(blocked)).toBe("Waiting for Reading a job you added, which stopped: Sign in with Claude again. Open Settings to go on.");
  });
});

describe("RUN_TITLES", () => {
  it("are the names the dashboard's run cards use, so Needs you and the cards call a run the same thing", () => {
    const commonJson = path.join(repoRoot(), "apps", "dashboard", "src", "i18n", "en", "common.json");
    const common = JSON.parse(fs.readFileSync(commonJson, "utf8")) as { run: { kind: Record<string, string> } };

    expect(RUN_TITLES).toEqual(common.run.kind);
  });
});
