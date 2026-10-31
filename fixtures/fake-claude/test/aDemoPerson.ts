// Test data built from Alex Rivera, the demo person: her confirmed story, a master resume made from it,
// a data sheet with placeholders, and a stand-in for the server's truth trace. The stub server in these
// tests answers with these, the way the real server would answer with the database.
import {
  Application,
  DataSheet,
  Profile,
  StoryItem,
} from "@jobgoblin/schemas";
import type {
  DataSheetKey,
  ResumeBody,
  ResumeEntry,
  ToolError,
} from "@jobgoblin/schemas";
import { z } from "zod";
import profileFixture from "../../profiles/alex-rivera.json";

const ProfileFixture = z.object({ profile: Profile, storyItems: z.array(StoryItem) });
const fixture = ProfileFixture.parse(profileFixture);

export const ALEX_PROFILE = fixture.profile;
export const ALEX_STORY_ITEMS: StoryItem[] = fixture.storyItems;

// What core.buildMasterResume makes: the headline, every experience and project with its achievements,
// every skill, and the education. The real function limits how many; Alex's story is already small.
export function aMasterResume(): ResumeBody {
  const headline = ALEX_STORY_ITEMS.find((item) => item.kind === "headline");

  return {
    headline: headline ? { src: headline.id, text: headline.data.text } : null,
    sections: {
      experience: entriesOfKind("experience"),
      projects: entriesOfKind("project"),
    },
    skills: ALEX_STORY_ITEMS.filter((item) => item.kind === "skill").map((item) => ({
      src: item.id,
      text: item.data.text,
    })),
    education: ALEX_STORY_ITEMS.filter((item) => item.kind === "education").map((item) => ({ src: item.id })),
  };
}

function entriesOfKind(kind: "experience" | "project"): ResumeEntry[] {
  return ALEX_STORY_ITEMS.filter((item) => item.kind === kind).map((parent) => ({
    src: parent.id,
    bullets: ALEX_STORY_ITEMS.filter((item) => item.kind === "achievement" && item.parentId === parent.id).map(
      (achievement) => ({ src: achievement.id, text: achievement.data.text }),
    ),
  }));
}

// The two checks of the truth trace that the made-up parts of a draft break: a bullet must cite a story
// item, and may not say "Led" when the story item does not. Paths are the ones the real trace reports.
export function traceDraftLikeTheServer(body: ResumeBody): ToolError[] {
  const errors: ToolError[] = [];

  for (const sectionName of ["experience", "projects"] as const) {
    body.sections[sectionName].forEach((entry, entryIndex) => {
      entry.bullets.forEach((bullet, bulletIndex) => {
        const path = `sections.${sectionName}[${entryIndex}].bullets[${bulletIndex}]`;
        const item = ALEX_STORY_ITEMS.find((candidate) => candidate.id === bullet.src);

        if (item === undefined) {
          errors.push({ code: "untraced", path, message: `This bullet cites "${bullet.src}", which is not in your story.` });
        } else if (/^Led\b/.test(bullet.text) && !/^Led\b/.test(item.data.text)) {
          errors.push({ code: "inflated-verb", path, message: 'This bullet says "led", but your story does not.' });
        }
      });
    });
  }
  return errors;
}

// A data sheet as a run sees it: personal values are "{key}" placeholders, never the real values.
export function aDataSheet(applicationId: string): DataSheet {
  const value: Partial<Record<DataSheetKey, string>> = {
    fullName: "{fullName}",
    firstName: "{firstName}",
    email: "{email}",
    phone: "{phone}",
    location: "{location}",
    workAuthorized: "Yes",
    requiresSponsorship: "No",
    willingToRelocate: "Yes",
    noticePeriod: "2 weeks",
    earliestStartDate: "2026-12-01",
    yearsExperience: "2",
    expectedBase: "{expectedBase}",
  };

  return DataSheet.parse({
    applicationId,
    region: "US",
    fields: Object.entries(value).map(([key, text]) => ({
      key,
      label: key,
      value: text,
      personal: text.startsWith("{"),
      required: key === "fullName" || key === "email" || key === "phone",
      missing: false,
    })),
    resumeVersion: `r-${"a".repeat(64)}`,
    resumeFileName: "{fullName} - Resume.pdf",
  });
}

export function anApplication(overrides: Partial<Application> = {}): Application {
  return Application.parse({
    id: "app-1",
    jobId: "greenhouse:acmecloud:1",
    company: "Acme Cloud",
    title: "Backend Engineer",
    status: "Awaiting approval",
    fitScore: 86,
    band: "apply",
    resumeVersion: null,
    submitMode: "manual",
    folder: null,
    appliedAt: null,
    followUpOn: null,
    tailorAttempts: 0,
    tailorError: null,
    createdAt: "2026-10-30T09:00:00.000Z",
    updatedAt: "2026-10-30T09:00:00.000Z",
    ...overrides,
  });
}
