// Test data for the core tests: the demo person Alex Rivera from fixtures/README.md, as Your story items
// and a profile. Small named helpers build the pieces, so each test shows only what it is about.
// Only tests import this file; index.ts does not export it.
import { Profile } from "@jobgoblin/schemas";
import type { ResumeBody, StoryItem, StoryItemData } from "@jobgoblin/schemas";

const SOME_TIME = "2026-10-31T00:00:00.000Z";

type StoryItemOptions = Partial<Omit<StoryItem, "data">> & {
  id: string;
  kind: StoryItem["kind"];
  data: Partial<StoryItemData> & { text: string };
};

export function aStoryItem(options: StoryItemOptions): StoryItem {
  return {
    parentId: null,
    status: "confirmed",
    keywords: [],
    createdAt: SOME_TIME,
    updatedAt: SOME_TIME,
    ...options,
    data: { tools: [], numbers: [], ...options.data },
  };
}

type AchievementOptions = { id: string; parentId: string; text: string; tools?: string[]; numbers?: string[] };

export function aConfirmedAchievement(options: AchievementOptions): StoryItem {
  const { id, parentId, ...data } = options;
  return aStoryItem({ id, kind: "achievement", parentId, data });
}

// Ids Alex's story items use, so a test can say ALEX.onCall instead of repeating a string.
export const ALEX = {
  headline: "headline-1",
  northwind: "exp-northwind",
  api: "ach-api",
  latency: "ach-latency",
  kubernetes: "ach-kubernetes",
  onCall: "ach-on-call",
  contoso: "exp-contoso",
  typescriptService: "ach-typescript-service",
  integrationTests: "ach-integration-tests",
  ledgerline: "proj-ledgerline",
  ledger: "ach-ledger",
  school: "edu-state",
  skillPython: "skill-python",
} as const;

const SKILL_NAMES = ["Python", "TypeScript", "Go", "PostgreSQL", "Redis", "Docker", "Kubernetes", "AWS", "React", "Terraform"];

export function alexRiveraStory(): StoryItem[] {
  return [
    aStoryItem({
      id: ALEX.headline,
      kind: "headline",
      data: { text: "Backend engineer who builds reliable APIs and the platforms they run on" },
    }),
    aStoryItem({
      id: ALEX.northwind,
      kind: "experience",
      data: {
        text: "Software Engineer at Northwind Logistics",
        title: "Software Engineer",
        organization: "Northwind Logistics",
        location: "Austin, TX",
        startDate: "2024-06",
        endDate: "Present",
      },
    }),
    aConfirmedAchievement({
      id: ALEX.api,
      parentId: ALEX.northwind,
      text: "Built a shipment-tracking API in Python and PostgreSQL that serves 2M requests a day",
      tools: ["Python", "PostgreSQL"],
      numbers: ["2M"],
    }),
    aConfirmedAchievement({
      id: ALEX.latency,
      parentId: ALEX.northwind,
      text: "Cut p95 latency of the orders service 40% by adding a Redis read-through cache",
      tools: ["Redis"],
      numbers: ["40%"],
    }),
    aConfirmedAchievement({
      id: ALEX.kubernetes,
      parentId: ALEX.northwind,
      text: "Led the migration of 12 services from VMs to Kubernetes on AWS with zero downtime",
      tools: ["Kubernetes", "AWS"],
      numbers: ["12"],
    }),
    aConfirmedAchievement({
      id: ALEX.onCall,
      parentId: ALEX.northwind,
      text: "Contributed to the on-call rotation and wrote 15 runbooks for incident response",
      numbers: ["15"],
    }),
    aStoryItem({
      id: ALEX.contoso,
      kind: "experience",
      data: {
        text: "Software Engineering Intern at Contoso Health",
        title: "Software Engineering Intern",
        organization: "Contoso Health",
        location: "Remote",
        startDate: "2023-05",
        endDate: "2023-08",
      },
    }),
    aConfirmedAchievement({
      id: ALEX.typescriptService,
      parentId: ALEX.contoso,
      text: "Designed a TypeScript service that syncs patient appointment data between two systems",
      tools: ["TypeScript"],
    }),
    aConfirmedAchievement({
      id: ALEX.integrationTests,
      parentId: ALEX.contoso,
      text: "Wrote integration tests that raised coverage of the scheduling module from 55% to 85%",
      numbers: ["55%", "85%"],
    }),
    aStoryItem({
      id: ALEX.ledgerline,
      kind: "project",
      data: { text: "Ledgerline, open-source double-entry ledger in Go", title: "Ledgerline", tools: ["Go"] },
    }),
    aConfirmedAchievement({
      id: ALEX.ledger,
      parentId: ALEX.ledgerline,
      text: "Built an open-source double-entry ledger library in Go with 300 GitHub stars",
      tools: ["Go"],
      numbers: ["300"],
    }),
    aStoryItem({
      id: ALEX.school,
      kind: "education",
      data: {
        text: "B.S. Computer Science, State University",
        title: "B.S. Computer Science",
        organization: "State University",
        location: "Austin, TX",
        startDate: "2020-08",
        endDate: "2024-05",
      },
    }),
    ...SKILL_NAMES.map((name) =>
      aStoryItem({
        id: name === "Python" ? ALEX.skillPython : `skill-${name.toLowerCase()}`,
        kind: "skill",
        data: { text: name },
      }),
    ),
  ];
}

// A resume body made only of Alex's story: every part copies its item's text word for word.
export function alexRiveraMasterBody(): ResumeBody {
  return {
    headline: { src: ALEX.headline, text: "Backend engineer who builds reliable APIs and the platforms they run on" },
    sections: {
      experience: [
        {
          src: ALEX.northwind,
          bullets: [
            { src: ALEX.api, text: "Built a shipment-tracking API in Python and PostgreSQL that serves 2M requests a day" },
            { src: ALEX.onCall, text: "Contributed to the on-call rotation and wrote 15 runbooks for incident response" },
          ],
        },
      ],
      projects: [],
    },
    skills: [{ src: ALEX.skillPython, text: "Python" }],
    education: [{ src: ALEX.school }],
  };
}

// Alex's profile as the fixtures describe it. The expected base salary is still TODO.
export function alexRiveraProfile(): Profile {
  return Profile.parse({
    contact: {
      fullName: "Alex Rivera",
      email: "alex.rivera@example.com",
      phone: "+1 555 0100",
      location: "Austin, TX",
      github: "github.com/alexrivera-example",
    },
    workAuthorization: {
      regions: {
        US: { authorized: true, requiresSponsorship: false, willingToRelocate: true },
        REMOTE: { authorized: true, requiresSponsorship: false, willingToRelocate: true },
      },
    },
    employment: {
      currentEmployer: "Northwind Logistics",
      currentTitle: "Software Engineer",
      noticePeriod: "2 weeks",
      earliestStartDate: "2026-12-01",
      yearsExperience: "2",
    },
    targets: {
      roles: ["Backend Engineer", "Platform Engineer", "Software Engineer"],
      regions: ["US", "REMOTE"],
      maxYearsRequired: 4,
      rolesToAvoid: ["QA", "SDET", "Test Engineer", "Quality Engineer"],
    },
    rules: { bannedTerms: ["rockstar", "ninja"] },
  });
}
