// The "view model": everything the template prints, as plain strings, with every decision already made.
// A ResumeBody only says which Your story items were chosen and what each bullet says; this file joins
// it with those items to find each company, title, location and date range. The template then only
// lays text out. Facts like these come from the cited story item, never from the run's text.
// Spec: "Resume pipeline"; ARCHITECTURE.md section 8.1.
import type { ResumeBody, ResumeEntry, ResumeHeader, StoryItem } from "@jobgoblin/schemas";
import { buildContactItems, type ContactItem } from "./contactLine";
import { formatDateRange } from "./resumeDates";

// One experience, project or school, laid out on up to two rows:
//   row 1:  heading (bold) | headingNote (italic)     headingRight
//   row 2:  subheading (italic)                        subheadingRight
// Experience: company / location, then title / dates. Education: school / location, then degree / dates.
// Project: name | tools / dates, and no second row. An empty cell is simply left blank.
export type ViewEntry = {
  heading: string;
  headingNote: string;
  headingRight: string;
  subheading: string;
  subheadingRight: string;
  bullets: string[];
};

// The JSON the template receives in `sys.inputs.resume`. templates/t1/resume.typ reads these exact names.
export type ResumeView = {
  versionId: string; // goes into the PDF's metadata
  documentTitle: string;
  fullName: string;
  contact: ContactItem[];
  headline: string | null;
  experience: ViewEntry[];
  projects: ViewEntry[];
  skills: string[];
  education: ViewEntry[];
};

export type ResumeViewInput = {
  header: ResumeHeader;
  body: ResumeBody;
  storyItems: StoryItem[];
  versionId: string;
};

export function buildResumeView(input: ResumeViewInput): ResumeView {
  const { header, body, versionId } = input;
  const lookup = createStoryLookup(input.storyItems);

  return {
    versionId,
    documentTitle: header.fullName.trim() === "" ? "Resume" : `${header.fullName.trim()} - Resume`,
    fullName: header.fullName.trim(),
    contact: buildContactItems(header),
    headline: body.headline === null ? null : body.headline.text,
    experience: body.sections.experience.map((entry) => experienceEntry(entry, lookup(entry.src))),
    projects: body.sections.projects.map((entry) => projectEntry(entry, lookup(entry.src))),
    skills: body.skills.map((skill) => skill.text),
    // Education is copied from Your story by code; the body only says which schools to include.
    education: body.education.map((school) => educationEntry(lookup(school.src))),
  };
}

function experienceEntry(entry: ResumeEntry, item: StoryItem): ViewEntry {
  return {
    heading: item.data.organization ?? item.data.text,
    headingNote: "",
    headingRight: item.data.location ?? "",
    subheading: item.data.title ?? "",
    subheadingRight: formatDateRange(item.data.startDate, item.data.endDate),
    bullets: entry.bullets.map((bullet) => bullet.text),
  };
}

function projectEntry(entry: ResumeEntry, item: StoryItem): ViewEntry {
  return {
    heading: item.data.title ?? item.data.text,
    headingNote: item.data.tools.join(", "),
    headingRight: formatDateRange(item.data.startDate, item.data.endDate),
    subheading: "",
    subheadingRight: "",
    bullets: entry.bullets.map((bullet) => bullet.text),
  };
}

function educationEntry(item: StoryItem): ViewEntry {
  return {
    heading: item.data.organization ?? item.data.text,
    headingNote: "",
    headingRight: item.data.location ?? "",
    subheading: item.data.title ?? "",
    subheadingRight: formatDateRange(item.data.startDate, item.data.endDate),
    bullets: [],
  };
}

// The truth trace has already checked every `src` before a resume is rendered, so a missing item here
// is a programming mistake (the wrong story items were passed in). It throws instead of printing a gap.
function createStoryLookup(storyItems: StoryItem[]): (id: string) => StoryItem {
  const itemsById = new Map<string, StoryItem>();
  for (const item of storyItems) itemsById.set(item.id, item);

  return (id) => {
    const item = itemsById.get(id);
    if (item === undefined) {
      throw new Error(`Cannot render the resume: it cites "${id}", which is not among the story items given.`);
    }
    return item;
  };
}
