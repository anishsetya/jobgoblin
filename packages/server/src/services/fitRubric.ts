// The fit rubric: the instructions a run scores jobs by, kept as playbooks/rubric.md so it can be read and
// edited like any other file. Its first line is `<!-- rubric-version: 1 -->`; that number is stored with every
// fit, so a score can always be traced to the rubric that produced it. Whoever edits the rubric raises it.
// Spec: ARCHITECTURE.md sections 5.5 (rubricVersion) and 9 (get_fit_context); runner README decision 14.
import fs from "node:fs";
import path from "node:path";
import type { ServerContext } from "../context";

// Used only when playbooks/rubric.md is missing (a half-installed copy), so scoring still works.
const FALLBACK_RUBRIC =
  "Score 0 to 100 how well the person's confirmed story fits the job: skills, seniority and location. 75 and up apply, 60 to 74 stretch, 50 to 59 long shot, under 50 skip.";

// What a fit says when the file has no version line.
export const UNVERSIONED_RUBRIC = "unversioned";

const VERSION_LINE = /^<!--\s*rubric-version:\s*([^\s>]+)\s*-->/;

export type Rubric = { text: string; version: string };

export function readRubric(ctx: ServerContext): Rubric {
  const rubricPath = path.join(ctx.resourcesDir, "playbooks", "rubric.md");
  try {
    const text = fs.readFileSync(rubricPath, "utf8");
    return { text, version: rubricVersionOf(text) };
  } catch (error) {
    ctx.logger.warn({ err: error }, "playbooks/rubric.md could not be read, so the built-in rubric is used.");
    return { text: FALLBACK_RUBRIC, version: UNVERSIONED_RUBRIC };
  }
}

// The version named on the first line of the rubric, such as "1".
export function rubricVersionOf(rubricText: string): string {
  const firstLine = rubricText.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  return VERSION_LINE.exec(firstLine)?.[1] ?? UNVERSIONED_RUBRIC;
}
