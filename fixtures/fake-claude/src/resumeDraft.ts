// The small edits a tailor run makes to the master resume, as pure functions on a ResumeBody.
// The fake never writes new text: it only reorders and drops parts that already exist in Your story.
// The one exception, addPartsThatCannotBeTraced, makes a resume that the truth trace must refuse,
// so tests can watch the server say no and the run repair itself.
// Spec: ARCHITECTURE.md sections 8.2 (truth trace) and 14 (tailor).
import type { ResumeBody, ResumeEntry, SourcedText, ToolError } from "@jobgoblin/schemas";
import { mentionsTerm } from "./textMatching";

// Bullets (and skills) that mention a must-have move to the front. Their order is otherwise unchanged,
// and so is every entry, so the person sees a small, easy-to-read difference from the master resume.
export function putMustHavesFirst(master: ResumeBody, mustHaves: string[]): ResumeBody {
  const draft = structuredClone(master);

  for (const entry of [...draft.sections.experience, ...draft.sections.projects]) {
    entry.bullets = mentionedFirst(entry.bullets, mustHaves);
  }
  draft.skills = mentionedFirst(draft.skills, mustHaves);
  return draft;
}

function mentionedFirst(parts: SourcedText[], mustHaves: string[]): SourcedText[] {
  const mentioning = parts.filter((part) => mentionsAnyTerm(part.text, mustHaves));
  const others = parts.filter((part) => !mentionsAnyTerm(part.text, mustHaves));
  return [...mentioning, ...others];
}

function mentionsAnyTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => mentionsTerm(text, term));
}

// How an edit request shows up: the last bullet of the first entry goes. It is a visible, repeatable
// change; the fake cannot understand what the person actually asked for.
export function dropLastBulletOfFirstEntry(body: ResumeBody): ResumeBody {
  const draft = structuredClone(body);
  firstEntryOf(draft)?.bullets.pop();
  return draft;
}

function firstEntryOf(body: ResumeBody): ResumeEntry | undefined {
  return body.sections.experience[0] ?? body.sections.projects[0];
}

// FAKE_CLAUDE_REWORD: the one rewording a real run might make, so Review has a reworded line to highlight.
// The first bullet that says "... that ..." becomes "..., which ...". Every number, tool, verb and name is
// kept, so the truth trace accepts it.
const REWORD_FROM = " that ";
const REWORD_TO = ", which ";

export function rewordFirstBulletThatCan(body: ResumeBody): ResumeBody {
  const draft = structuredClone(body);

  for (const entry of [...draft.sections.experience, ...draft.sections.projects]) {
    const bullet = entry.bullets.find((candidate) => candidate.text.includes(REWORD_FROM));
    if (bullet === undefined) continue;
    bullet.text = bullet.text.replace(REWORD_FROM, REWORD_TO);
    return draft;
  }
  return draft;
}

// ---------------------------------------------------------------------------------------------
// FAKE_CLAUDE_INVENT_BULLET: a draft the truth trace must refuse
// ---------------------------------------------------------------------------------------------

const MISSING_STORY_ITEM_ID = "story-item-that-does-not-exist";
const INFLATED_OPENING = { honest: "Contributed to", inflated: "Led" };

// Adds two lies to the first entry: a bullet that cites a story item that does not exist (`untraced`),
// and a bullet whose "Contributed to" became "Led" (`inflated-verb`).
export function addPartsThatCannotBeTraced(body: ResumeBody): ResumeBody {
  const draft = structuredClone(body);

  firstEntryOf(draft)?.bullets.push({
    src: MISSING_STORY_ITEM_ID,
    text: "Saved the company $1M by rewriting the billing system",
  });

  for (const entry of [...draft.sections.experience, ...draft.sections.projects]) {
    for (const bullet of entry.bullets) {
      if (!bullet.text.startsWith(INFLATED_OPENING.honest)) continue;
      bullet.text = INFLATED_OPENING.inflated + bullet.text.slice(INFLATED_OPENING.honest.length);
      return draft; // one is enough
    }
  }
  return draft;
}

// ---------------------------------------------------------------------------------------------
// Repair: drop the parts the server's errors point at
// ---------------------------------------------------------------------------------------------

// A part to remove: one element of an array (a bullet, a skill, an entry), or the headline.
type Removal = { kind: "array-element"; array: unknown[]; element: unknown } | { kind: "headline" };

// Errors name a part by path, such as "sections.experience[0].bullets[2]". Each is dropped; the rest of
// the draft is kept. `droppedCount` is 0 when no error pointed at a part that could be dropped (a
// "pages" error, say), which tells the caller that dropping cannot help.
export function dropPartsNamedByErrors(
  body: ResumeBody,
  errors: ToolError[],
): { body: ResumeBody; droppedCount: number } {
  const draft = structuredClone(body);

  // Find every part first: removing one bullet would shift the index in the path of the next error.
  const removals: Removal[] = [];
  for (const error of errors) {
    const removal = error.path === undefined ? null : findPartToRemove(draft, error.path);
    if (removal !== null) removals.push(removal);
  }

  let droppedCount = 0;
  for (const removal of removals) {
    if (remove(draft, removal)) droppedCount += 1;
  }
  return { body: draft, droppedCount };
}

// Walks the path. The last array element it passes through is the part to drop, so a path that points
// inside a bullet ("...bullets[2].text") drops the whole bullet.
function findPartToRemove(draft: ResumeBody, path: string): Removal | null {
  let cursor: unknown = draft;
  let removal: Removal | null = null;

  for (const segment of path.split(".")) {
    const step = /^(\w+)(?:\[(\d+)\])?$/.exec(segment);
    const key = step?.[1];
    if (key === undefined || !isRecord(cursor)) break;

    const child = cursor[key];
    const index = step?.[2];

    if (index === undefined) {
      if (cursor === draft && key === "headline") removal = { kind: "headline" };
      cursor = child;
      continue;
    }

    if (!Array.isArray(child)) break;
    const element: unknown = child[Number(index)];
    if (element === undefined) break;
    removal = { kind: "array-element", array: child, element };
    cursor = element;
  }
  return removal;
}

function remove(draft: ResumeBody, removal: Removal): boolean {
  if (removal.kind === "headline") {
    const hadHeadline = draft.headline !== null;
    draft.headline = null;
    return hadHeadline;
  }

  const position = removal.array.indexOf(removal.element);
  if (position === -1) return false; // two errors pointed at the same part
  removal.array.splice(position, 1);
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
