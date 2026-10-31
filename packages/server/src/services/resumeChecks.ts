// The checks a resume draft must pass before it can be reviewed: every part traces to Your story, no banned
// word appears, and the per-company limit still holds. All errors come back at once, so a run can fix the
// whole draft in one go. (The one-page and banned-word-in-the-PDF checks need the rendered file and are in resumes.ts.)
// Truthfulness control: a resume is only a selection from what the person confirmed.
// Spec: ARCHITECTURE.md section 8.2 and 8.4 (steps 1 and 2).
import { z } from "zod";
import type { Application, Job, ResumeBody, ResumeCheckError } from "@jobgoblin/schemas";
import { checkLimits, findBannedTerms, traceResume, type TextToCheck } from "@jobgoblin/core";
import { getProfileSection, getSettings, listLimitCandidates, listStoryItems } from "@jobgoblin/storage";
import type { ServerContext } from "../context";

export function checkDraftContent(
  ctx: ServerContext,
  application: Application,
  job: Job,
  body: ResumeBody,
): ResumeCheckError[] {
  const errors = [
    ...traceResume(body, listStoryItems(ctx.db)),
    ...findBannedTerms(textsOf(body), getProfileSection(ctx.db, "rules").bannedTerms),
  ];

  // The backstop: tailoring was admitted within the limits, but they may have changed since.
  const settings = getSettings(ctx.db);
  const limitProblem = checkLimits({
    applicationId: application.id,
    company: application.company,
    dedupeKey: job.dedupeKey,
    others: listLimitCandidates(ctx.db, { company: application.company, dedupeKey: job.dedupeKey }),
    now: ctx.now(),
    maxOpenPerCompany: settings.maxOpenPerCompany,
    reapplyDays: settings.reapplyDays,
  });
  return limitProblem === null ? errors : [...errors, limitProblem];
}

// Every piece of text on the resume with the place it is, in the form findBannedTerms reports.
export function textsOf(body: ResumeBody): TextToCheck[] {
  const texts: TextToCheck[] = [];
  if (body.headline !== null) texts.push({ path: "headline", text: body.headline.text });

  const sections = [
    ["sections.experience", body.sections.experience],
    ["sections.projects", body.sections.projects],
  ] as const;
  for (const [sectionPath, entries] of sections) {
    entries.forEach((entry, entryIndex) => {
      entry.bullets.forEach((bullet, bulletIndex) => {
        texts.push({ path: `${sectionPath}[${entryIndex}].bullets[${bulletIndex}]`, text: bullet.text });
      });
    });
  }
  body.skills.forEach((skill, index) => texts.push({ path: `skills[${index}]`, text: skill.text }));
  return texts;
}

// A body that does not match the ResumeBody schema, as errors a run can act on.
export function schemaErrorsOf(error: z.ZodError): ResumeCheckError[] {
  return error.issues.map((issue) => ({
    code: "schema",
    path: pathText(issue.path),
    message: `The resume body is not in the expected shape here: ${issue.message}`,
  }));
}

// ["sections", "experience", 0, "bullets", 2] becomes "sections.experience[0].bullets[2]".
function pathText(path: readonly PropertyKey[]): string {
  let text = "";
  for (const part of path) {
    if (typeof part === "number") text += `[${part}]`;
    else text += text === "" ? String(part) : `.${String(part)}`;
  }
  return text === "" ? "body" : text;
}
