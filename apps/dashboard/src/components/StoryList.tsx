// Your story as a list the person can work through. `mode="pending"` (setup) shows only what still needs a
// decision, with each experience or project kept as the heading of its achievements. `mode="all"` (Profile)
// shows everything that has not been dropped.
import type { StoryItem } from "@jobgoblin/schemas";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { groupStory, type StoryGroup } from "@/lib/storyGroups";
import { StoryGroupCard } from "./StoryGroupCard";
import { StoryItemCard } from "./StoryItemCard";

type StoryListProps = {
  items: StoryItem[];
  mode: "pending" | "all";
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function LooseItems({ items }: { items: StoryItem[] }) {
  return (
    <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
      {items.map((item) => (
        <li key={item.id} className="p-4">
          <StoryItemCard item={item} />
        </li>
      ))}
    </ul>
  );
}

export function StoryList({ items, mode }: StoryListProps) {
  const { t } = useTranslation();
  const grouped = groupStory(items);

  const showsItem = (item: StoryItem): boolean => mode === "all" || item.status === "pending";

  // A group is shown when its heading or any of its achievements is shown.
  function groupsToShow(groups: StoryGroup[]): { group: StoryGroup; visibleChildren: StoryItem[] }[] {
    return groups
      .map((group) => ({ group, visibleChildren: group.children.filter(showsItem) }))
      .filter(({ group, visibleChildren }) => showsItem(group.parent) || visibleChildren.length > 0);
  }

  const experiences = groupsToShow(grouped.experiences);
  const projects = groupsToShow(grouped.projects);
  const headlines = grouped.headlines.filter(showsItem);
  const skills = grouped.skills.filter(showsItem);
  const education = grouped.education.filter(showsItem);
  const orphans = grouped.orphans.filter(showsItem);

  return (
    <div className="space-y-8">
      {experiences.length > 0 && (
        <Section title={t("common:story.sections.experience")}>
          <ul className="space-y-3">
            {experiences.map(({ group, visibleChildren }) => (
              <StoryGroupCard key={group.parent.id} group={group} visibleChildren={visibleChildren} />
            ))}
          </ul>
        </Section>
      )}
      {projects.length > 0 && (
        <Section title={t("common:story.sections.projects")}>
          <ul className="space-y-3">
            {projects.map(({ group, visibleChildren }) => (
              <StoryGroupCard key={group.parent.id} group={group} visibleChildren={visibleChildren} />
            ))}
          </ul>
        </Section>
      )}
      {headlines.length > 0 && (
        <Section title={t("common:story.sections.headline")}>
          <LooseItems items={headlines} />
        </Section>
      )}
      {skills.length > 0 && (
        <Section title={t("common:story.sections.skills")}>
          <LooseItems items={skills} />
        </Section>
      )}
      {education.length > 0 && (
        <Section title={t("common:story.sections.education")}>
          <LooseItems items={education} />
        </Section>
      )}
      {orphans.length > 0 && (
        <Section title={t("common:story.sections.other")}>
          <LooseItems items={orphans} />
        </Section>
      )}
    </div>
  );
}
