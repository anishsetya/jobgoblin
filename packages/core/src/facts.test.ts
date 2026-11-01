import { describe, expect, it } from "vitest";
import { createVocabulary, extractFacts, supportedKeys, vocabularyFromStory } from "./facts";
import { aStoryItem, alexRiveraStory } from "./testing/alexRivera";

const NO_EXTRA_TERMS = createVocabulary({ tools: [], names: [] });

function keysIn(text: string, vocabulary = NO_EXTRA_TERMS): string[] {
  return extractFacts(text, vocabulary).map((fact) => fact.key);
}

describe("extractFacts: numbers", () => {
  it("finds plain numbers, percentages, multipliers and money", () => {
    expect(keysIn("Cut latency 40% and served 500 teams")).toEqual(["number:40%", "number:500"]);
    expect(keysIn("A 3x speed-up on a $2M budget")).toEqual(["number:3x", "number:$2m"]);
  });

  it("reads the same number written two ways as one fact", () => {
    expect(keysIn("1,200 users")).toEqual(keysIn("1200 users"));
    expect(keysIn("2 million requests")).toEqual(keysIn("2M requests"));
    expect(keysIn("40 percent")).toEqual(keysIn("40%"));
  });

  it("keeps decimals together", () => {
    expect(keysIn("99.9% uptime")).toEqual(["number:99.9%"]);
  });

  it("does not read the digits inside names as numbers", () => {
    expect(keysIn("p95 latency on S3 and EC2 with Python3")).toEqual(["tool:ec2", "tool:s3"]);
  });

  it("tells 40% from 50%", () => {
    expect(keysIn("40%")).not.toEqual(keysIn("50%"));
  });
});

describe("extractFacts: dates", () => {
  it("reads month and year in every common spelling as one date", () => {
    expect(keysIn("since June 2024")).toEqual(["date:2024-06"]);
    expect(keysIn("since Jun 2024")).toEqual(["date:2024-06"]);
    expect(keysIn("since 2024-06")).toEqual(["date:2024-06"]);
    expect(keysIn("since 06/2024")).toEqual(["date:2024-06"]);
    expect(keysIn("since Sept. 2023")).toEqual(["date:2023-09"]);
  });

  it("reads a bare year as a year, and does not also read its digits as a number", () => {
    expect(keysIn("shipped in 2025")).toEqual(["date:2025"]);
  });

  it("treats a month and year as backing its bare year, and nothing more", () => {
    const story = extractFacts("Started 2024-06", NO_EXTRA_TERMS);
    const supported = supportedKeys(story);

    expect(supported.has("date:2024-06")).toBe(true);
    expect(supported.has("date:2024")).toBe(true);
    expect(supported.has("date:2024-07")).toBe(false);
    expect(supported.has("date:2025")).toBe(false);
  });
});

describe("extractFacts: tools", () => {
  it("finds technologies from the built-in list, ignoring case", () => {
    expect(keysIn("Deployed with terraform and kafka").sort()).toEqual(["tool:kafka", "tool:terraform"]);
  });

  it("finds tools and skills from Your story", () => {
    const vocabulary = createVocabulary({ tools: ["Zig", "Event Sourcing"], names: [] });

    expect(keysIn("Wrote a Zig parser using event   sourcing", vocabulary)).toEqual(["tool:zig", "tool:event sourcing"]);
  });

  it("matches whole words only: Java is not JavaScript, and C is not C++", () => {
    const vocabulary = createVocabulary({ tools: ["C"], names: [] });

    expect(keysIn("Wrote JavaScript", vocabulary)).toEqual(["tool:javascript"]);
    expect(keysIn("Wrote C++", vocabulary)).toEqual(["tool:c++"]);
    expect(keysIn("Wrote C", vocabulary)).toEqual(["tool:c"]);
  });

  it("matches names that are also everyday words only when written as listed", () => {
    expect(keysIn("Wrote services in Go")).toEqual(["tool:go"]);
    expect(keysIn("Became the go-to person for the rest of the team")).toEqual([]);
    expect(keysIn("Spark jobs, not a spark of joy")).toEqual(["tool:spark"]);
  });

  it("does not find R in R&D", () => {
    const vocabulary = createVocabulary({ tools: ["R"], names: [] });

    expect(keysIn("Joined the R&D team", vocabulary)).toEqual([]);
  });
});

describe("extractFacts: names", () => {
  it("finds job titles and organizations from Your story, ignoring case", () => {
    const vocabulary = vocabularyFromStory(alexRiveraStory());

    expect(keysIn("As a software engineer at northwind logistics", vocabulary)).toEqual([
      "name:software engineer",
      "name:northwind logistics",
    ]);
  });

  it("does not read Software Engineer inside Software Engineering Intern", () => {
    const vocabulary = vocabularyFromStory(alexRiveraStory());

    expect(keysIn("Worked as a Software Engineering Intern", vocabulary)).toEqual(["name:software engineering intern"]);
  });

  it("finds well-known employers that Your story never mentions", () => {
    expect(keysIn("Built tooling used at Google")).toEqual(["name:google"]);
  });
});

describe("vocabularyFromStory", () => {
  it("includes the tools and skills of items that are not confirmed", () => {
    const pendingSkill = aStoryItem({ id: "skill-zig", kind: "skill", status: "pending", data: { text: "Zig" } });
    const vocabulary = vocabularyFromStory([...alexRiveraStory(), pendingSkill]);

    expect(keysIn("Used Zig", vocabulary)).toEqual(["tool:zig"]);
  });
});
