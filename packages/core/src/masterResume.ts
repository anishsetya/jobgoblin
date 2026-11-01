// The master resume: the default one-page selection from Your story, built by code when setup finishes.
// Tailoring starts from it, and Review shows what a tailored resume changed against it.
// Only confirmed items are used. Spec: "Resume pipeline". ARCHITECTURE.md decision D7 and section 6.
import type { ResumeBody, ResumeEntry, StoryItem } from "@jobgoblin/schemas";

export const MASTER_MAX_ACHIEVEMENTS_PER_EXPERIENCE = 4;
export const MASTER_MAX_PROJECTS = 2;
export const MASTER_MAX_ACHIEVEMENTS_PER_PROJECT = 2;
export const MASTER_MAX_SKILLS = 12;

// Experiences newest first with up to 4 achievements each; up to 2 projects with up to 2 achievements;
// the first confirmed headline; up to 12 skills; all education. Achievements keep Your story's order.
export function buildMasterResume(storyItems: readonly StoryItem[]): ResumeBody {
  const confirmed = storyItems.filter((item) => item.status === "confirmed");
  const ofKind = (kind: StoryItem["kind"]): StoryItem[] => confirmed.filter((item) => item.kind === kind);

  const headline = ofKind("headline")[0];
  const experiences = newestFirst(ofKind("experience"));
  const projects = newestFirst(ofKind("project")).slice(0, MASTER_MAX_PROJECTS);
  const education = newestFirst(ofKind("education"));

  return {
    headline: headline === undefined ? null : { src: headline.id, text: headline.data.text },
    sections: {
      experience: experiences.map((item) => entryFor(item, confirmed, MASTER_MAX_ACHIEVEMENTS_PER_EXPERIENCE)),
      projects: projects.map((item) => entryFor(item, confirmed, MASTER_MAX_ACHIEVEMENTS_PER_PROJECT)),
    },
    skills: ofKind("skill")
      .slice(0, MASTER_MAX_SKILLS)
      .map((item) => ({ src: item.id, text: item.data.text })),
    education: education.map((item) => ({ src: item.id })),
  };
}

function entryFor(parent: StoryItem, confirmed: readonly StoryItem[], maxAchievements: number): ResumeEntry {
  const achievements = confirmed.filter((item) => item.kind === "achievement" && item.parentId === parent.id);
  return {
    src: parent.id,
    bullets: achievements.slice(0, maxAchievements).map((item) => ({ src: item.id, text: item.data.text })),
  };
}

// Sorts by when the item ended (still going, "Present", is newest), then by when it started.
// Items with the same dates keep their order in Your story.
function newestFirst(items: readonly StoryItem[]): StoryItem[] {
  return [...items].sort((a, b) => {
    const byEnd = compareText(endKey(b), endKey(a));
    return byEnd !== 0 ? byEnd : compareText(b.data.startDate ?? "", a.data.startDate ?? "");
  });
}

// Dates are "YYYY-MM" or "YYYY", which sort correctly as text. "Present" sorts after every year.
function endKey(item: StoryItem): string {
  const end = item.data.endDate ?? item.data.startDate ?? "";
  return end === "Present" ? "9999-99" : end;
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
