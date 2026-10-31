import type { StoryItem } from "@jobgoblin/schemas";
import { describe, expect, it } from "vitest";
import { ALEX_RIVERA_PROPOSED_ITEMS } from "./data";
import { bandForScore, scoreJob } from "./fitScoring";
import { mentionsTerm } from "./textMatching";

// Alex's story as confirmed items, made from the same file the setup run proposes.
const STORY_ITEMS: StoryItem[] = ALEX_RIVERA_PROPOSED_ITEMS.map((proposed) => ({
  id: proposed.tempId,
  kind: proposed.kind,
  parentId: proposed.parentTempId,
  status: "confirmed",
  data: proposed.data,
  keywords: proposed.keywords,
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-01T09:00:00.000Z",
}));

function aJob(overrides: { company?: string; title?: string; text?: string }) {
  return { jobId: "job-1", company: "Some Company", title: "Backend Engineer", text: "", ...overrides };
}

describe("scoreJob", () => {
  it("uses the fixed score for a job in data/scores.json, whatever its text says", () => {
    const fit = scoreJob(aJob({ company: "Brightpath", title: "Platform Engineer", text: "Nothing relevant." }), STORY_ITEMS);

    expect(fit.score).toBe(68);
    expect(fit.track).toBe("platform");
  });

  it("finds the fixed score without regard to case or extra spaces", () => {
    const fit = scoreJob(aJob({ company: "  acme   CLOUD", title: "backend engineer" }), STORY_ITEMS);

    expect(fit.score).toBe(86);
  });

  it("scores a job that is not listed from the number of different terms it shares with Your story", () => {
    const text = "Kubernetes and AWS and Python";

    const fit = scoreJob(aJob({ text }), STORY_ITEMS);

    expect(fit.score).toBe(30 + 3 * 10);
  });

  it("never scores above 95 from keywords alone", () => {
    const everything = "Python PostgreSQL Redis Kubernetes AWS TypeScript Go API latency cache migration on-call testing coverage";

    expect(scoreJob(aJob({ text: everything }), STORY_ITEMS).score).toBe(95);
  });

  it("gives a reason that fits the band", () => {
    const apply = scoreJob(aJob({ company: "Acme Cloud", title: "Backend Engineer", text: "Python" }), STORY_ITEMS);
    const skip = scoreJob(aJob({ company: "Copperleaf AI", title: "Data Analyst" }), STORY_ITEMS);

    expect(apply.reason).toMatch(/^Strong match/);
    expect(skip.score).toBe(20);
    expect(skip.reason).toMatch(/^Little overlap/);
  });

  it("chooses a track from the title", () => {
    const track = (title: string) => scoreJob(aJob({ title }), STORY_ITEMS).track;

    expect(track("Software Engineer, Applied AI")).toBe("ai");
    expect(track("Forward-Deployed Engineer")).toBe("fde");
    expect(track("Site Reliability Engineer")).toBe("platform");
    expect(track("Backend Engineer")).toBe("backend");
  });

  it("lists must-haves the story does not show as gaps", () => {
    const fit = scoreJob(aJob({ text: "You know Python and Kafka." }), STORY_ITEMS);

    expect(fit.mustHaves).toEqual(["Python", "Kafka"]);
    expect(fit.gaps).toEqual(["Kafka"]);
  });
});

describe("bandForScore", () => {
  it("uses the cut-offs 75, 60 and 50", () => {
    expect([100, 75, 74, 60, 59, 50, 49, 0].map(bandForScore)).toEqual([
      "apply", "apply", "stretch", "stretch", "long-shot", "long-shot", "skip", "skip",
    ]);
  });
});

describe("mentionsTerm", () => {
  it("matches whole words only, ignoring case", () => {
    expect(mentionsTerm("We use postgresql daily", "PostgreSQL")).toBe(true);
    expect(mentionsTerm("We use JavaScript", "Java")).toBe(false);
    expect(mentionsTerm("We use PostgreSQL", "SQL")).toBe(false);
  });

  it("matches terms that start or end with a symbol", () => {
    expect(mentionsTerm("Knowledge of C++ is a plus", "C++")).toBe(true);
    expect(mentionsTerm("Join our on-call rotation", "on-call")).toBe(true);
  });

  it("matches a very short name such as Go only in its capitalised spelling", () => {
    expect(mentionsTerm("We write Go and Python", "Go")).toBe(true);
    expect(mentionsTerm("We write Go and Python", "go")).toBe(true);
    expect(mentionsTerm("We go fast", "Go")).toBe(false);
    expect(mentionsTerm("We go fast", "go")).toBe(false);
  });
});
