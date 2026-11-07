// Findings log. finding() appends one line to AUDIT_DIR/findings.jsonl. A finding is "confirmed" only when two
// different runs (AUDIT_RUN=1 and AUDIT_RUN=2) recorded the same id; summarize.ts decides that, not this file.
// check() is expect.soft plus a finding, so one problem does not hide the next.
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { AUDIT_DIR, AUDIT_RUN, auditPath } from "./paths";

export type Severity = "P0" | "P1" | "P2" | "P3";

export type FindingInput = {
  id: string; // J1-1, H2, ...
  severity: Severity;
  title: string; // one line
  persona: "Maya" | "Alex" | "Both";
  area: string; // the screen or feature
  prd: string; // requirement id or rule, "-" when none
  expected: string;
  actual: string;
  steps?: string;
  evidence: string[]; // paths under AUDIT_DIR, or test names
  suspectedFile?: string; // file:line
  wrong: "product" | "test" | "unclear";
};

export function finding(input: FindingInput): void {
  const line = {
    kind: "finding",
    ...input,
    run: AUDIT_RUN,
    at: new Date().toISOString(),
    test: safeTitle(),
  };
  fs.appendFileSync(auditPath("findings.jsonl"), `${JSON.stringify(line)}\n`);
}

// Things seen on the way (console errors, 4xx responses, axe hits). Not findings until someone judges them.
export function observation(kind: string, detail: Record<string, unknown>): void {
  const line = { kind: `observation:${kind}`, ...detail, run: AUDIT_RUN, at: new Date().toISOString(), test: safeTitle() };
  fs.appendFileSync(auditPath("observations.jsonl"), `${JSON.stringify(line)}\n`);
}

// Soft-asserts a condition; when it does not hold, records the finding. Returns whether it held.
export function check(condition: boolean, input: FindingInput): boolean {
  if (!condition) finding(input);
  expect.soft(condition, `${input.id}: ${input.title}`).toBe(true);
  return condition;
}

// Writes any text to a file under AUDIT_DIR and returns the path (for the evidence list).
export function saveEvidence(relativePath: string, text: string): string {
  const full = path.join(AUDIT_DIR, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
}

function safeTitle(): string {
  try {
    return test.info().titlePath.slice(1).join(" > ");
  } catch {
    return "";
  }
}
