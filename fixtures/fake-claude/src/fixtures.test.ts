// The demo person lives in three files that must tell the same story: the render agent's resume fixture,
// the profile fixture for tests that skip setup, and the story the fake's setup run proposes.
// These tests fail if one of them is edited and the others are not.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Profile, ProposedStoryItem, StoryItem, TODO } from "@jobgoblin/schemas";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ALEX_RIVERA_PROPOSED_ITEMS, FIXED_SCORES } from "./data";

function readFixture(relativePath: string): unknown {
  const file = fileURLToPath(new URL(relativePath, import.meta.url));
  return JSON.parse(readFileSync(file, "utf8"));
}

const profileFixture = z
  .object({ profile: Profile, storyItems: z.array(StoryItem) })
  .parse(readFixture("../../profiles/alex-rivera.json"));

const resumeFixture = z
  .object({ storyItems: z.array(StoryItem) })
  .parse(readFixture("../../resumes/alex-rivera.story.json"));

// What two story files must agree on, item by item.
function identityOf(item: { id: string; kind: string; parentId: string | null; text: string }) {
  return { id: item.id, kind: item.kind, parentId: item.parentId, text: item.text };
}

const fromStoryItem = (item: StoryItem) => identityOf({ ...item, text: item.data.text });
const fromProposedItem = (item: ProposedStoryItem) =>
  identityOf({ id: item.tempId, kind: item.kind, parentId: item.parentTempId, text: item.data.text });

describe("the demo person's profile fixture", () => {
  it("is a complete profile: re-parsing it adds no defaults", () => {
    expect(Profile.parse(profileFixture.profile)).toEqual(profileFixture.profile);
  });

  it("has exactly one value still to fill in: the expected base salary", () => {
    const stillTodo: string[] = [];
    for (const [sectionName, section] of Object.entries(profileFixture.profile)) {
      for (const [key, value] of Object.entries(section)) {
        if (value === TODO) stillTodo.push(`${sectionName}.${key}`);
      }
    }

    expect(stillTodo).toEqual(["compensation.expectedBase"]);
  });

  it("matches the demo person in fixtures/README.md", () => {
    const { contact, targets, rules, workAuthorization, employment } = profileFixture.profile;

    expect(contact).toMatchObject({ fullName: "Alex Rivera", email: "alex.rivera@example.com", location: "Austin, TX" });
    expect(targets.regions).toEqual(["US", "REMOTE"]);
    expect(targets.maxYearsRequired).toBe(4);
    expect(targets.rolesToAvoid).toEqual(["QA", "SDET", "Test Engineer", "Quality Engineer"]);
    expect(rules.bannedTerms).toEqual(["rockstar", "ninja"]);
    expect(workAuthorization.regions.US).toEqual({ authorized: true, requiresSponsorship: false, willingToRelocate: true });
    expect(employment).toMatchObject({ noticePeriod: "2 weeks", earliestStartDate: "2026-12-01" });
  });

  it("holds only confirmed story items, and every achievement belongs to an experience or project", () => {
    const parents = new Map(profileFixture.storyItems.map((item) => [item.id, item.kind]));

    for (const item of profileFixture.storyItems) {
      expect(item.status).toBe("confirmed");
      if (item.kind === "achievement") expect(["experience", "project"]).toContain(parents.get(item.parentId ?? ""));
    }
  });
});

describe("the demo person's three story files", () => {
  it("agree on every story item's id, kind, parent and text, in the same order", () => {
    const fromResumeFixture = resumeFixture.storyItems.map(fromStoryItem);

    expect(profileFixture.storyItems.map(fromStoryItem)).toEqual(fromResumeFixture);
    expect(ALEX_RIVERA_PROPOSED_ITEMS.map(fromProposedItem)).toEqual(fromResumeFixture);
  });

  it("proposes items the schema accepts, with temporary ids that become the fixture's ids", () => {
    expect(() => z.array(ProposedStoryItem).parse(ALEX_RIVERA_PROPOSED_ITEMS)).not.toThrow();
    expect(ALEX_RIVERA_PROPOSED_ITEMS).toHaveLength(22);
  });
});

describe("the fake scores", () => {
  it("are the ones in fixtures/README.md, plus Gridline Energy", () => {
    expect(FIXED_SCORES).toEqual({
      "Acme Cloud|Backend Engineer": 86,
      "Brightpath|Platform Engineer": 68,
      "Copperleaf AI|Software Engineer, Applied AI": 55,
      "Copperleaf AI|Data Analyst": 20,
      "Gridline Energy|Backend Engineer": 78,
    });
  });
});
