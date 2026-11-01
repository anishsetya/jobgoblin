import { describe, expect, it } from "vitest";
import { ResumeBody } from "@jobgoblin/schemas";
import type { StoryItem } from "@jobgoblin/schemas";
import { buildMasterResume } from "./masterResume";
import { traceResume } from "./truthTrace";
import { ALEX, aConfirmedAchievement, aStoryItem, alexRiveraStory } from "./testing/alexRivera";

function withStatus(items: StoryItem[], id: string, status: StoryItem["status"]): StoryItem[] {
  return items.map((item) => (item.id === id ? { ...item, status } : item));
}

describe("buildMasterResume", () => {
  const master = buildMasterResume(alexRiveraStory());

  it("builds a resume the schema accepts and the truth trace passes", () => {
    expect(ResumeBody.safeParse(master).success).toBe(true);
    expect(traceResume(master, alexRiveraStory())).toEqual([]);
  });

  it("uses the first confirmed headline", () => {
    expect(master.headline).toEqual({
      src: ALEX.headline,
      text: "Backend engineer who builds reliable APIs and the platforms they run on",
    });
  });

  it("lists experiences newest first, whatever order Your story holds them in", () => {
    const northwindFirst = alexRiveraStory();
    const northwindLast = [...northwindFirst.filter((item) => item.id !== ALEX.northwind), ...northwindFirst.filter((item) => item.id === ALEX.northwind)];

    const result = buildMasterResume(northwindLast);

    expect(result.sections.experience.map((entry) => entry.src)).toEqual([ALEX.northwind, ALEX.contoso]);
  });

  it("puts a job that is still going ahead of a newer-starting job that has ended", () => {
    const story = [
      aStoryItem({ id: "ended", kind: "experience", data: { text: "x", startDate: "2025-01", endDate: "2025-03" } }),
      aStoryItem({ id: "current", kind: "experience", data: { text: "x", startDate: "2020-01", endDate: "Present" } }),
    ];

    expect(buildMasterResume(story).sections.experience.map((entry) => entry.src)).toEqual(["current", "ended"]);
  });

  it("gives each experience its own achievements, in Your story's order", () => {
    const northwind = master.sections.experience[0];

    expect(northwind?.bullets.map((bullet) => bullet.src)).toEqual([ALEX.api, ALEX.latency, ALEX.kubernetes, ALEX.onCall]);
    expect(master.sections.experience[1]?.bullets.map((bullet) => bullet.src)).toEqual([
      ALEX.typescriptService,
      ALEX.integrationTests,
    ]);
  });

  it("takes at most 4 achievements per experience", () => {
    const extra = [1, 2, 3].map((n) => aConfirmedAchievement({ id: `extra-${n}`, parentId: ALEX.northwind, text: `Extra ${n}` }));

    const result = buildMasterResume([...alexRiveraStory(), ...extra]);

    expect(result.sections.experience[0]?.bullets).toHaveLength(4);
  });

  it("takes at most 2 projects with at most 2 achievements each, newest first", () => {
    const project = (id: string, startDate: string) => aStoryItem({ id, kind: "project", data: { text: id, startDate } });
    const story = [
      project("old-project", "2019"),
      project("new-project", "2025-02"),
      project("middle-project", "2022"),
      ...[1, 2, 3].map((n) => aConfirmedAchievement({ id: `a-${n}`, parentId: "new-project", text: `Did ${n}` })),
    ];

    const result = buildMasterResume(story);

    expect(result.sections.projects.map((entry) => entry.src)).toEqual(["new-project", "middle-project"]);
    expect(result.sections.projects[0]?.bullets).toHaveLength(2);
  });

  it("takes at most 12 skills and all the education", () => {
    const skills = Array.from({ length: 15 }, (_, n) => aStoryItem({ id: `s-${n}`, kind: "skill", data: { text: `Skill ${n}` } }));
    const schools = ["a", "b"].map((id) => aStoryItem({ id: `edu-${id}`, kind: "education", data: { text: id } }));

    const result = buildMasterResume([...skills, ...schools]);

    expect(result.skills).toHaveLength(12);
    expect(result.skills[0]).toEqual({ src: "s-0", text: "Skill 0" });
    expect(result.education).toHaveLength(2);
  });

  it("leaves out anything that is pending or rejected, and the achievements of an experience left out", () => {
    const story = withStatus(withStatus(alexRiveraStory(), ALEX.latency, "pending"), ALEX.contoso, "rejected");

    const result = buildMasterResume(story);

    expect(result.sections.experience.map((entry) => entry.src)).toEqual([ALEX.northwind]);
    expect(result.sections.experience[0]?.bullets.map((bullet) => bullet.src)).not.toContain(ALEX.latency);
  });

  it("uses no headline when none is confirmed", () => {
    const result = buildMasterResume(withStatus(alexRiveraStory(), ALEX.headline, "pending"));

    expect(result.headline).toBeNull();
  });

  it("builds an empty resume from an empty story", () => {
    expect(buildMasterResume([])).toEqual({
      headline: null,
      sections: { experience: [], projects: [] },
      skills: [],
      education: [],
    });
  });
});

