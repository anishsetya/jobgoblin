import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ResumeBody, ResumeCheckError, StoryItem } from "@jobgoblin/schemas";
import { traceResume } from "./truthTrace";
import {
  ALEX,
  aConfirmedAchievement,
  aStoryItem,
  alexRiveraMasterBody,
  alexRiveraStory,
} from "./testing/alexRivera";

// Alex's master resume with the bullets of the Northwind entry replaced by `bullets`.
function resumeWithNorthwindBullets(bullets: { src: string; text: string }[]): ResumeBody {
  const body = alexRiveraMasterBody();
  const northwind = body.sections.experience[0];
  if (northwind === undefined) throw new Error("The test data should have a Northwind entry.");
  northwind.bullets = bullets;
  return body;
}

function traceNorthwindBullet(src: string, text: string, story: StoryItem[] = alexRiveraStory()): ResumeCheckError[] {
  return traceResume(resumeWithNorthwindBullets([{ src, text }]), story);
}

describe("traceResume: a resume made of Your story", () => {
  it("passes when every part copies its story item", () => {
    expect(traceResume(alexRiveraMasterBody(), alexRiveraStory())).toEqual([]);
  });

  it("passes when a line is reworded without changing a fact or claiming more", () => {
    const errors = traceNorthwindBullet(
      ALEX.latency,
      "Reduced p95 latency of the orders service by 40% with a Redis read-through cache",
    );

    expect(errors).toEqual([]);
  });

  it("passes when a line uses the story's verb in another tense", () => {
    const errors = traceNorthwindBullet(ALEX.api, "Building a shipment-tracking API in Python and PostgreSQL for 2M requests a day");

    expect(errors).toEqual([]);
  });

  it("accepts dates, titles and the employer that come from the entry the bullet sits under", () => {
    const errors = traceNorthwindBullet(
      ALEX.onCall,
      "Contributed to the on-call rotation as a Software Engineer at Northwind Logistics since 2024, writing 15 runbooks",
    );

    expect(errors).toEqual([]);
  });
});

describe("traceResume: untraced (rules 1 and 2)", () => {
  it("refuses a part that cites an item that is not in Your story", () => {
    const errors = traceNorthwindBullet("ach-made-up", "Built a thing");

    expect(errors).toEqual([
      {
        code: "untraced",
        path: "sections.experience[0].bullets[0]",
        message: expect.stringContaining("is not in your story"),
      },
    ]);
  });

  it("refuses a bullet that cites a pending item", () => {
    const story = [...alexRiveraStory(), aConfirmedAchievement({ id: "ach-new", parentId: ALEX.northwind, text: "Built a cache" })];
    const pending = story.map((item) => (item.id === "ach-new" ? { ...item, status: "pending" as const } : item));

    const errors = traceNorthwindBullet("ach-new", "Built a cache", pending);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "untraced", path: "sections.experience[0].bullets[0]" });
    expect(errors[0]?.message).toContain("has not been confirmed yet");
  });

  it("refuses a bullet that cites a rejected item", () => {
    const story = alexRiveraStory().map((item) => (item.id === ALEX.api ? { ...item, status: "rejected" as const } : item));

    expect(traceNorthwindBullet(ALEX.api, "Built a shipment-tracking API", story)[0]?.code).toBe("untraced");
  });

  it("refuses a bullet that sits under the wrong experience", () => {
    const errors = traceNorthwindBullet(ALEX.typescriptService, "Designed a TypeScript service that syncs patient appointment data");

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "untraced", path: "sections.experience[0].bullets[0]" });
    expect(errors[0]?.message).toContain("belongs to a different experience or project");
  });

  it("refuses a bullet that cites an item of the wrong kind, and says what kind is needed", () => {
    const errors = traceNorthwindBullet(ALEX.skillPython, "Python");

    expect(errors[0]?.code).toBe("untraced");
    expect(errors[0]?.message).toContain("is a skill, but this place needs an achievement");
  });

  it("refuses an experience entry that cites a project", () => {
    const body = alexRiveraMasterBody();
    body.sections.experience = [{ src: ALEX.ledgerline, bullets: [] }];

    const errors = traceResume(body, alexRiveraStory());

    expect(errors).toEqual([
      expect.objectContaining({ code: "untraced", path: "sections.experience[0]" }),
    ]);
  });

  it("refuses a headline that cites an achievement", () => {
    const body = alexRiveraMasterBody();
    body.headline = { src: ALEX.api, text: "Backend engineer" };

    const errors = traceResume(body, alexRiveraStory());

    expect(errors).toEqual([expect.objectContaining({ code: "untraced", path: "headline" })]);
  });

  it("refuses education that cites an experience", () => {
    const body = alexRiveraMasterBody();
    body.education = [{ src: ALEX.northwind }];

    expect(traceResume(body, alexRiveraStory())).toEqual([
      expect.objectContaining({ code: "untraced", path: "education[0]" }),
    ]);
  });

  it("accepts a skill with the same text ignoring case and spacing", () => {
    const body = alexRiveraMasterBody();
    body.skills = [{ src: ALEX.skillPython, text: " PYTH on " }];

    expect(traceResume(body, alexRiveraStory())).toEqual([]);
  });

  it("refuses a skill whose text differs from the skill it cites", () => {
    const body = alexRiveraMasterBody();
    body.skills = [{ src: ALEX.skillPython, text: "Python 3" }];

    const errors = traceResume(body, alexRiveraStory());

    expect(errors).toEqual([expect.objectContaining({ code: "untraced", path: "skills[0]" })]);
    expect(errors[0]?.message).toContain('the skill in your story is "Python"');
  });
});

describe("traceResume: changed-fact (rule 3)", () => {
  it("refuses a changed number and names both numbers", () => {
    const errors = traceNorthwindBullet(
      ALEX.latency,
      "Cut p95 latency of the orders service 50% by adding a Redis read-through cache",
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "changed-fact", path: "sections.experience[0].bullets[0]" });
    expect(errors[0]?.message).toContain('Bullet 1 of Northwind Logistics says "50%", but your story has "40%"');
  });

  it("refuses a number that the story item does not have at all", () => {
    const errors = traceNorthwindBullet(ALEX.onCall, "Contributed to the on-call rotation and wrote 15 runbooks for 30 teams");

    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("changed-fact");
    expect(errors[0]?.message).toContain('"30"');
  });

  it("refuses a well-known employer that is not in the item, even if Your story never mentions it", () => {
    const errors = traceNorthwindBullet(ALEX.api, "Built a shipment-tracking API in Python and PostgreSQL for Google");

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "changed-fact" });
    expect(errors[0]?.message).toContain('"Google"');
  });

  it("refuses an organization from another story item, even when the story does mention it", () => {
    const withGoogleInternship = [
      ...alexRiveraStory(),
      aStoryItem({ id: "exp-google", kind: "experience", data: { text: "Intern at Google", organization: "Google" } }),
    ];

    const errors = traceNorthwindBullet(ALEX.api, "Built a shipment-tracking API in Python and PostgreSQL at Google", withGoogleInternship);

    expect(errors.map((error) => error.code)).toEqual(["changed-fact"]);
  });

  it("refuses a job title from another story item", () => {
    const errors = traceNorthwindBullet(
      ALEX.api,
      "Built a shipment-tracking API in Python and PostgreSQL as a Software Engineering Intern",
    );

    expect(errors.map((error) => error.code)).toEqual(["changed-fact"]);
    expect(errors[0]?.message).toContain('"Software Engineering Intern"');
  });

  it("refuses a tool the story item does not list, whether or not the story lists it elsewhere", () => {
    const fromBuiltInList = traceNorthwindBullet(ALEX.api, "Built a shipment-tracking API in Python and PostgreSQL on Kafka");
    const fromStory = traceNorthwindBullet(ALEX.api, "Built a shipment-tracking API in Python and PostgreSQL on Docker");

    expect(fromBuiltInList.map((error) => error.code)).toEqual(["changed-fact"]);
    expect(fromStory.map((error) => error.code)).toEqual(["changed-fact"]);
    expect(fromStory[0]?.message).toContain('"Docker"');
  });

  it("refuses a tool that only a pending story item mentions", () => {
    const withPendingZig = [...alexRiveraStory(), aStoryItem({ id: "skill-zig", kind: "skill", status: "pending", data: { text: "Zig" } })];

    const errors = traceNorthwindBullet(ALEX.api, "Built a shipment-tracking API in Python and PostgreSQL with Zig", withPendingZig);

    expect(errors.map((error) => error.code)).toEqual(["changed-fact"]);
  });

  it("refuses a year the story does not have, and accepts the year of the entry", () => {
    const wrongYear = traceNorthwindBullet(ALEX.onCall, "Contributed to the on-call rotation since 2019 and wrote 15 runbooks");
    const rightYear = traceNorthwindBullet(ALEX.onCall, "Contributed to the on-call rotation since 2024 and wrote 15 runbooks");

    expect(wrongYear.map((error) => error.code)).toEqual(["changed-fact"]);
    expect(rightYear).toEqual([]);
  });

  it("refuses a month the story does not have, and accepts the entry's month in any spelling", () => {
    const wrongMonth = traceNorthwindBullet(ALEX.onCall, "Contributed to the on-call rotation from March 2024 and wrote 15 runbooks");
    const rightMonth = traceNorthwindBullet(ALEX.onCall, "Contributed to the on-call rotation from June 2024 and wrote 15 runbooks");

    expect(wrongMonth.map((error) => error.code)).toEqual(["changed-fact"]);
    expect(rightMonth).toEqual([]);
  });

  it("refuses a changed fact in the headline", () => {
    const body = alexRiveraMasterBody();
    body.headline = { src: ALEX.headline, text: "Backend engineer with 10 years building reliable APIs" };

    const errors = traceResume(body, alexRiveraStory());

    expect(errors).toEqual([expect.objectContaining({ code: "changed-fact", path: "headline" })]);
  });
});

describe("traceResume: inflated-verb (rule 4)", () => {
  it('refuses "Led" when the story says "Contributed to", and quotes both', () => {
    const errors = traceNorthwindBullet(ALEX.onCall, "Led the on-call rotation and wrote 15 runbooks for incident response");

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "inflated-verb", path: "sections.experience[0].bullets[0]" });
    expect(errors[0]?.message).toBe(
      'Bullet 1 of Northwind Logistics says "led", but your story says "contributed". Use the story\'s verb.',
    );
  });

  it("refuses a strong verb in any tense", () => {
    const errors = traceNorthwindBullet(ALEX.onCall, "Leading the on-call rotation and writing 15 runbooks for incident response");

    expect(errors.map((error) => error.code)).toEqual(["inflated-verb"]);
  });

  it("refuses a stronger verb even when the story has a different strong verb", () => {
    const errors = traceNorthwindBullet(ALEX.api, "Architected a shipment-tracking API in Python and PostgreSQL that serves 2M requests a day");

    expect(errors.map((error) => error.code)).toEqual(["inflated-verb"]);
  });

  it("reports a strong verb once, however often it appears", () => {
    const errors = traceNorthwindBullet(ALEX.onCall, "Led the on-call rotation and led 15 runbooks for incident response");

    expect(errors).toHaveLength(1);
  });

  it("does not mistake a noun for a claim: system design and at scale are fine", () => {
    const withDesignWork = [
      ...alexRiveraStory(),
      aConfirmedAchievement({ id: "ach-docs", parentId: ALEX.northwind, text: "Wrote system design docs" }),
    ];

    expect(traceNorthwindBullet("ach-docs", "Wrote system design docs that work at scale", withDesignWork)).toEqual([]);
  });

});

describe("traceResume: all problems come back together, in reading order", () => {
  it("reports every error at once with the path of each", () => {
    const body = resumeWithNorthwindBullets([
      { src: ALEX.latency, text: "Cut p95 latency of the orders service 50% by adding a Redis read-through cache" },
      { src: "ach-made-up", text: "Built a thing" },
      { src: ALEX.onCall, text: "Led the on-call rotation and wrote 15 runbooks for incident response" },
    ]);
    body.headline = { src: ALEX.headline, text: "Backend engineer who builds reliable APIs and the platforms they run on" };

    const errors = traceResume(body, alexRiveraStory());

    expect(errors.map((error) => [error.code, error.path])).toEqual([
      ["changed-fact", "sections.experience[0].bullets[0]"],
      ["untraced", "sections.experience[0].bullets[1]"],
      ["inflated-verb", "sections.experience[0].bullets[2]"],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Property: a resume that only copies its story can never fail
// ---------------------------------------------------------------------------------------------

// Pieces that the checks look at (numbers, dates, tools, names, strong verbs) mixed with ordinary words.
const WORDS = [
  "Built", "Led", "Contributed", "to", "the", "API", "latency", "by", "40%", "3x", "$2M", "500", "2 million", "12",
  "Python", "Go", "Redis", "Kafka", "Google", "Northwind Logistics", "Software Engineer", "2024", "June 2024",
  "2023-05", "p95", "S3", "R&D", "go-to", "at scale", "owned", "shipped", "mentored", "C++", "C",
];

const someText = fc.oneof(
  fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 12 }).map((words) => words.join(" ")),
  fc.string({ minLength: 1, maxLength: 60 }),
);

const someAchievement = fc.record({
  text: someText,
  tools: fc.array(fc.constantFrom("Python", "Go", "Zig", "Redis"), { maxLength: 3 }),
  numbers: fc.array(fc.constantFrom("40%", "500", "3x"), { maxLength: 2 }),
});

const someEntry = fc.record({
  title: fc.constantFrom("Software Engineer", "Intern", "Founding Engineer"),
  organization: fc.constantFrom("Northwind Logistics", "Contoso Health", "Google"),
  startDate: fc.constantFrom("2023-05", "2024-06", "2020"),
  achievements: fc.array(someAchievement, { maxLength: 4 }),
});

describe("traceResume: property", () => {
  it("always passes a resume whose every part copies its story item's text word for word", () => {
    const someStory = fc.record({
      headline: someText,
      entries: fc.array(someEntry, { maxLength: 3 }),
      skills: fc.array(someText, { maxLength: 4 }),
    });

    fc.assert(
      fc.property(someStory, (generated) => {
        const items: StoryItem[] = [];
        const body: ResumeBody = {
          headline: { src: "headline", text: generated.headline },
          sections: { experience: [], projects: [] },
          skills: [],
          education: [{ src: "school" }],
        };
        items.push(aStoryItem({ id: "headline", kind: "headline", data: { text: generated.headline } }));
        items.push(aStoryItem({ id: "school", kind: "education", data: { text: "B.S. Computer Science", title: "B.S. Computer Science" } }));

        for (const [entryIndex, entry] of generated.entries.entries()) {
          const entryId = `exp-${entryIndex}`;
          items.push(aStoryItem({ id: entryId, kind: "experience", data: { text: entry.title, title: entry.title, organization: entry.organization, startDate: entry.startDate } }));
          const bullets = entry.achievements.map((achievement, bulletIndex) => {
            const id = `${entryId}-ach-${bulletIndex}`;
            items.push(aConfirmedAchievement({ id, parentId: entryId, ...achievement }));
            return { src: id, text: achievement.text };
          });
          body.sections.experience.push({ src: entryId, bullets });
        }
        for (const [skillIndex, text] of generated.skills.entries()) {
          items.push(aStoryItem({ id: `skill-${skillIndex}`, kind: "skill", data: { text } }));
          body.skills.push({ src: `skill-${skillIndex}`, text });
        }

        expect(traceResume(body, items)).toEqual([]);
      }),
    );
  });
});
