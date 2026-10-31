// The truth trace: checks that every part of a resume can be traced to something the person confirmed.
// A part must cite a confirmed story item of the right kind, keep that item's facts (numbers, dates, tools,
// names) and not claim a stronger verb than the item uses ("contributed to" must not become "led").
// Errors come back as values with plain-words messages a run can act on, all at once.
// Spec: "Resume pipeline" step 2. ARCHITECTURE.md section 8.2.
import type {
  ResumeBody,
  ResumeCheckError,
  ResumeEntry,
  SourcedText,
  StoryItem,
  StoryItemKind,
} from "@jobgoblin/schemas";
import { extractFacts, supportedKeys, vocabularyFromStory, withoutDuplicateFacts } from "./facts";
import type { Fact, FactKind, Vocabulary } from "./facts";
import { findStrongVerbs } from "./strongVerbs";

// ---------------------------------------------------------------------------------------------
// traceResume
// ---------------------------------------------------------------------------------------------

type Story = { byId: ReadonlyMap<string, StoryItem>; vocabulary: Vocabulary };

// Pass every story item, whatever its status: a pending item is how "not confirmed yet" is told apart
// from "not in your story", and every tool in the story is needed to recognise tool names.
export function traceResume(body: ResumeBody, storyItems: readonly StoryItem[]): ResumeCheckError[] {
  const story: Story = {
    byId: new Map(storyItems.map((item) => [item.id, item])),
    vocabulary: vocabularyFromStory(storyItems),
  };
  return [
    ...traceHeadline(body.headline, story),
    ...traceEntries("experience", "sections.experience", body.sections.experience, story),
    ...traceEntries("project", "sections.projects", body.sections.projects, story),
    ...traceSkills(body.skills, story),
    ...traceEducation(body.education, story),
  ];
}

function traceHeadline(headline: SourcedText | null, story: Story): ResumeCheckError[] {
  if (headline === null) return [];

  const subject = "The headline";
  const cited = resolveCitation(headline.src, "headline", story);
  if ("problem" in cited) return [untraced("headline", subject, headline.src, cited.problem, "headline")];

  return checkWording({ subject, path: "headline", text: headline.text, item: cited.item, parent: null }, story);
}

function traceEntries(
  kind: "experience" | "project",
  pathPrefix: string,
  entries: readonly ResumeEntry[],
  story: Story,
): ResumeCheckError[] {
  const errors: ResumeCheckError[] = [];

  for (const [entryIndex, entry] of entries.entries()) {
    const entryPath = `${pathPrefix}[${entryIndex}]`;
    const entryItem = story.byId.get(entry.src);
    const entryName = entryItem === undefined ? `${kind} entry ${entryIndex + 1}` : nameOf(entryItem);

    const cited = resolveCitation(entry.src, kind, story);
    if ("problem" in cited) {
      errors.push(untraced(entryPath, `The ${kind} entry ${entryIndex + 1}`, entry.src, cited.problem, kind));
    }

    for (const [bulletIndex, bullet] of entry.bullets.entries()) {
      const subject = `Bullet ${bulletIndex + 1} of ${entryName}`;
      const path = `${entryPath}.bullets[${bulletIndex}]`;
      errors.push(...traceBullet(bullet, entry, entryItem, { subject, path }, story));
    }
  }
  return errors;
}

// A bullet cites an achievement that belongs to the entry it sits under.
function traceBullet(
  bullet: SourcedText,
  entry: ResumeEntry,
  entryItem: StoryItem | undefined,
  where: { subject: string; path: string },
  story: Story,
): ResumeCheckError[] {
  const cited = resolveCitation(bullet.src, "achievement", story);
  if ("problem" in cited) return [untraced(where.path, where.subject, bullet.src, cited.problem, "achievement")];

  if (cited.item.parentId !== entry.src) {
    const message =
      `${where.subject} cites "${bullet.src}", which belongs to a different experience or project. ` +
      "Cite one of this entry's own achievements.";
    return [{ code: "untraced", path: where.path, message }];
  }
  return checkWording({ ...where, text: bullet.text, item: cited.item, parent: entryItem ?? null }, story);
}

// Skills cite a skill whose text is the same, ignoring case and spacing.
function traceSkills(skills: readonly SourcedText[], story: Story): ResumeCheckError[] {
  const errors: ResumeCheckError[] = [];

  for (const [index, skill] of skills.entries()) {
    const subject = `Skill ${index + 1}`;
    const path = `skills[${index}]`;
    const cited = resolveCitation(skill.src, "skill", story);
    if ("problem" in cited) {
      errors.push(untraced(path, subject, skill.src, cited.problem, "skill"));
    } else if (squash(skill.text) !== squash(cited.item.data.text)) {
      const storyText = cited.item.data.text;
      const message = `${subject} says "${skill.text}", but the skill in your story is "${storyText}". Use the story's wording.`;
      errors.push({ code: "untraced", path, message });
    }
  }
  return errors;
}

function traceEducation(education: readonly { src: string }[], story: Story): ResumeCheckError[] {
  const errors: ResumeCheckError[] = [];

  for (const [index, entry] of education.entries()) {
    const cited = resolveCitation(entry.src, "education", story);
    if ("problem" in cited) {
      errors.push(untraced(`education[${index}]`, `Education entry ${index + 1}`, entry.src, cited.problem, "education"));
    }
  }
  return errors;
}

// "Node JS" and "nodejs" are the same skill; case and spacing do not matter.
function squash(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

// ---------------------------------------------------------------------------------------------
// Rules 1 and 2: the cited item exists, is confirmed, and is the right kind
// ---------------------------------------------------------------------------------------------

const KIND_WORDS: Record<StoryItemKind, string> = {
  experience: "an experience",
  project: "a project",
  education: "an education entry",
  achievement: "an achievement",
  skill: "a skill",
  headline: "a headline",
};

// The cited item, or why it cannot be cited here. The problem finishes the sentence '... cites "x", which ...'.
type Citation = { item: StoryItem } | { problem: string };

function resolveCitation(src: string, expectedKind: StoryItemKind, story: Story): Citation {
  const item = story.byId.get(src);
  if (item === undefined) return { problem: "is not in your story" };
  if (item.status !== "confirmed") return { problem: "has not been confirmed yet" };
  if (item.kind !== expectedKind) {
    return { problem: `is ${KIND_WORDS[item.kind]}, but this place needs ${KIND_WORDS[expectedKind]}` };
  }
  return { item };
}

function untraced(path: string, subject: string, src: string, problem: string, expectedKind: StoryItemKind): ResumeCheckError {
  return {
    code: "untraced",
    path,
    message: `${subject} cites "${src}", which ${problem}. Cite a confirmed ${expectedKind} from your story.`,
  };
}

// The name a message uses for an entry: "Northwind Logistics" for a job, "Ledgerline" for a project.
function nameOf(item: StoryItem): string {
  return item.data.organization ?? item.data.title ?? item.id;
}

// ---------------------------------------------------------------------------------------------
// Rules 3 and 4: the facts and verbs in a line come from the item it cites
// ---------------------------------------------------------------------------------------------

type Claim = {
  subject: string; // "Bullet 3 of Northwind Logistics"
  path: string;
  text: string; // what the resume says
  item: StoryItem; // what the story says
  parent: StoryItem | null; // for a bullet, its experience or project: dates, titles and employers come from there
};

function checkWording(claim: Claim, story: Story): ResumeCheckError[] {
  return [...checkFacts(claim, story.vocabulary), ...checkVerbs(claim)];
}

// Facts are read from each field of the item on its own and then combined, so text from one field
// can never run into the next ("12" at the end of one and "million" at the start of another).
function storyFactsFor(claim: Claim, vocabulary: Vocabulary): Fact[] {
  const fields = [...fieldsOf(claim.item), ...(claim.parent === null ? [] : fieldsOf(claim.parent))];
  return withoutDuplicateFacts(fields.flatMap((field) => extractFacts(field, vocabulary)));
}

function fieldsOf(item: StoryItem): string[] {
  const { text, title, organization, tools, numbers, startDate, endDate } = item.data;
  const optionalFields = [title, organization, startDate, endDate].filter((field) => field !== undefined);
  return [text, ...optionalFields, ...tools, ...numbers];
}

function checkFacts(claim: Claim, vocabulary: Vocabulary): ResumeCheckError[] {
  const storyFacts = storyFactsFor(claim, vocabulary);
  const supported = supportedKeys(storyFacts);
  const errors: ResumeCheckError[] = [];

  for (const fact of extractFacts(claim.text, vocabulary)) {
    if (supported.has(fact.key)) continue;
    errors.push({ code: "changed-fact", path: claim.path, message: describeChangedFact(claim.subject, fact, storyFacts) });
  }
  return errors;
}

const FACT_KIND_WORDS: Record<FactKind, string> = {
  number: "numbers",
  date: "dates",
  tool: "tools",
  name: "names",
};
const MOST_STORY_FACTS_QUOTED = 3;

function describeChangedFact(subject: string, fact: Fact, storyFacts: readonly Fact[]): string {
  const sameKind = storyFacts.filter((storyFact) => storyFact.kind === fact.kind);
  if (sameKind.length === 0) {
    return `${subject} mentions "${fact.shown}", which is not in your story item. Remove it.`;
  }
  const quoted = listInWords(sameKind.slice(0, MOST_STORY_FACTS_QUOTED).map((storyFact) => `"${storyFact.shown}"`));
  return `${subject} says "${fact.shown}", but your story has ${quoted}. Use the story's ${FACT_KIND_WORDS[fact.kind]}.`;
}

function listInWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function checkVerbs(claim: Claim): ResumeCheckError[] {
  const storyWording = [claim.item.data.text, claim.item.data.title ?? ""].join(" ");
  const storyVerbs = new Set(findStrongVerbs(storyWording).map((used) => used.verb));
  const storyOpening = firstWord(claim.item.data.text).toLowerCase();
  const errors: ResumeCheckError[] = [];

  for (const used of findStrongVerbs(claim.text)) {
    if (storyVerbs.has(used.verb)) continue;
    errors.push({
      code: "inflated-verb",
      path: claim.path,
      message: `${claim.subject} says "${used.written}", but your story says "${storyOpening}". Use the story's verb.`,
    });
  }
  return errors;
}

function firstWord(text: string): string {
  return text.trim().split(/\s+/)[0] ?? "";
}
