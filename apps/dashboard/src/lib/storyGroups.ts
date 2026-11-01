// Arranges the flat list of Your story items the way a resume reads: each experience or project with
// its achievements under it, then the loose items (headlines, skills, education).
// Dropped (rejected) items are left out; the person has decided they are never used.
import type { StoryItem } from "@jobgoblin/schemas";

export type StoryGroup = {
  parent: StoryItem; // an experience or a project
  children: StoryItem[]; // its achievements
};

export type GroupedStory = {
  experiences: StoryGroup[];
  projects: StoryGroup[];
  headlines: StoryItem[];
  skills: StoryItem[];
  education: StoryItem[];
  // Achievements whose experience or project is missing. They are shown so they are not lost.
  orphans: StoryItem[];
};

export function groupStory(items: StoryItem[]): GroupedStory {
  const keptItems = items.filter((item) => item.status !== "rejected");
  const parentIds = new Set(keptItems.filter(isParentKind).map((item) => item.id));

  function groupsOfKind(kind: "experience" | "project"): StoryGroup[] {
    return keptItems
      .filter((item) => item.kind === kind)
      .map((parent) => ({
        parent,
        children: keptItems.filter((item) => item.kind === "achievement" && item.parentId === parent.id),
      }));
  }

  return {
    experiences: groupsOfKind("experience"),
    projects: groupsOfKind("project"),
    headlines: keptItems.filter((item) => item.kind === "headline"),
    skills: keptItems.filter((item) => item.kind === "skill"),
    education: keptItems.filter((item) => item.kind === "education"),
    orphans: keptItems.filter(
      (item) => item.kind === "achievement" && (item.parentId === null || !parentIds.has(item.parentId)),
    ),
  };
}

function isParentKind(item: StoryItem): boolean {
  return item.kind === "experience" || item.kind === "project";
}

// The short name of an item for headings and button labels: a role or project name, else its text.
export function summaryOf(item: StoryItem): string {
  return item.data.title ?? item.data.text;
}
