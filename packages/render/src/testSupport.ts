// Shared by this package's tests and its fixture script: loads the demo person (Alex Rivera) from
// fixtures/resumes and builds the full demo resume body from Your story. It is not part of the public API.
// The real app builds a master resume with core.buildMasterResume; this is a small stand-in that picks
// the same things, because render may not import core (dependency rule: leaf packages use only schemas).
// Spec: fixtures/README.md "The demo person: Alex Rivera".
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ResumeHeader, StoryItem } from "@jobgoblin/schemas";
import type { ResumeBody, ResumeEntry } from "@jobgoblin/schemas";

export type DemoPerson = { header: ResumeHeader; storyItems: StoryItem[] };

const RESUME_FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/resumes/", import.meta.url));

export function resumeFixturePath(fileName: string): string {
  return RESUME_FIXTURES_DIR + fileName;
}

export function readResumeFixture(fileName: string): Uint8Array {
  return new Uint8Array(readFileSync(resumeFixturePath(fileName)));
}

export function loadAlexRivera(): DemoPerson {
  // The file's two halves are parsed with their schemas right away, so a typo in the fixture fails here.
  const file = JSON.parse(readFileSync(resumeFixturePath("alex-rivera.story.json"), "utf8")) as {
    header: unknown;
    storyItems: unknown;
  };
  return {
    header: ResumeHeader.parse(file.header),
    storyItems: StoryItem.array().parse(file.storyItems),
  };
}

// Every confirmed item of Your story, laid out like a master resume: newest experience first.
export function buildFullBody(storyItems: StoryItem[]): ResumeBody {
  const confirmed = storyItems.filter((item) => item.status === "confirmed");
  const headline = confirmed.find((item) => item.kind === "headline");

  return {
    headline: headline === undefined ? null : { src: headline.id, text: headline.data.text },
    sections: {
      experience: entriesOfKind(confirmed, "experience"),
      projects: entriesOfKind(confirmed, "project"),
    },
    skills: confirmed
      .filter((item) => item.kind === "skill")
      .map((item) => ({ src: item.id, text: item.data.text })),
    education: confirmed.filter((item) => item.kind === "education").map((item) => ({ src: item.id })),
  };
}

function entriesOfKind(confirmed: StoryItem[], kind: "experience" | "project"): ResumeEntry[] {
  const parents = confirmed
    .filter((item) => item.kind === kind)
    .sort((a, b) => (b.data.startDate ?? "").localeCompare(a.data.startDate ?? ""));

  return parents.map((parent) => ({
    src: parent.id,
    bullets: confirmed
      .filter((item) => item.kind === "achievement" && item.parentId === parent.id)
      .map((item) => ({ src: item.id, text: item.data.text })),
  }));
}
