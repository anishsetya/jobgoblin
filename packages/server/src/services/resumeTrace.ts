// The truth trace again, for a resume that already passed it as a draft. Your story can change after a draft
// is made (the person drops an item, or edits it and confirms it again), so the resume is traced against Your
// story as it is now: before Review offers Approve, and again when the person approves.
// Truthfulness control: a resume that uses a dropped or changed item is never frozen into an approved file.
// Spec: PRD T1, ARCHITECTURE.md sections 8.2 and 8.5.
import type { ResumeBody, StoryItem, UntracedResumeLine } from "@jobgoblin/schemas";
import { traceResume } from "@jobgoblin/core";
import { listStoryItems } from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { textsOf } from "./resumeChecks";

// Every place on the resume that no longer traces, once each, in the order the resume shows them.
export function findUntracedLines(ctx: ServerContext, body: ResumeBody): UntracedResumeLine[] {
  const storyItems = listStoryItems(ctx.db);
  const errors = traceResume(body, storyItems);
  if (errors.length === 0) return [];

  const textAt = lineTextsByPath(body, storyItems);
  const lines: UntracedResumeLine[] = [];
  for (const error of errors) {
    const isListed = lines.some((line) => line.path === error.path); // a line can break more than one rule
    if (!isListed) lines.push({ path: error.path, text: textAt.get(error.path) ?? error.path });
  }
  return lines;
}

// The words a person recognises for each place on the resume: the line itself for the headline, bullets and
// skills, and the job, project or school for an entry.
function lineTextsByPath(body: ResumeBody, storyItems: readonly StoryItem[]): Map<string, string> {
  const texts = new Map(textsOf(body).map((part) => [part.path, part.text]));
  const byId = new Map(storyItems.map((item) => [item.id, item]));
  const nameOf = (src: string): string => entryName(byId.get(src)) ?? src;

  body.sections.experience.forEach((entry, index) => texts.set(`sections.experience[${index}]`, nameOf(entry.src)));
  body.sections.projects.forEach((entry, index) => texts.set(`sections.projects[${index}]`, nameOf(entry.src)));
  body.education.forEach((school, index) => texts.set(`education[${index}]`, nameOf(school.src)));
  return texts;
}

// "Software Engineer, Northwind Logistics" for a job; the name alone when the item has only one of the two.
function entryName(item: StoryItem | undefined): string | null {
  if (item === undefined) return null;
  const { title, organization, text } = item.data;
  if (title !== undefined && organization !== undefined) return `${title}, ${organization}`;
  return organization ?? title ?? text;
}
