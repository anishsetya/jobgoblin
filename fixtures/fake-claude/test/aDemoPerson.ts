// Test data built from Alex Rivera, the demo person: her confirmed story, a master resume made from it,
// and an application row. The stub server in these tests answers with these, the way the real server
// would answer with the database.
import { Application, Profile, StoryItem } from "@jobgoblin/schemas";
import type { ResumeBody, ResumeEntry } from "@jobgoblin/schemas";
import { z } from "zod";
import profileFixture from "../../profiles/alex-rivera.json";

const ProfileFixture = z.object({ profile: Profile, storyItems: z.array(StoryItem) });
const fixture = ProfileFixture.parse(profileFixture);

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
