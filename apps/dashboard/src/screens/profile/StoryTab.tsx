// Profile > Your story: every experience, project, achievement, skill and headline, with what is still
// waiting for the person's confirmation. Only confirmed items are ever used in a resume or a fit score (PRD P2).
import { useTranslation } from "react-i18next";
import { useStory } from "@/api/story";
import { AddStoryItemDialog } from "@/components/AddStoryItemDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorNotice } from "@/components/ErrorNotice";
import { LoadingNote } from "@/components/LoadingNote";
import { StoryList } from "@/components/StoryList";

export function StoryTab() {
  const { t } = useTranslation();
  const story = useStory();

  if (story.isPending) return <LoadingNote />;
  if (story.isError) return <ErrorNotice error={story.error} onRetry={() => void story.refetch()} />;

  const items = story.data;
  const waitingCount = items.filter((item) => item.status === "pending").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted">{t("profile:story.intro")}</p>
        <AddStoryItemDialog items={items} />
      </div>

      {waitingCount > 0 && (
        <p role="status" className="rounded-md border border-flag-line bg-flag-soft p-3 text-sm text-flag">
          {t("profile:story.waiting", { count: waitingCount })}
        </p>
      )}

      {items.filter((item) => item.status !== "rejected").length === 0 ? (
        <EmptyState title={t("profile:story.empty.title")} description={t("profile:story.empty.description")} />
      ) : (
        <StoryList items={items} mode="all" />
      )}
    </div>
  );
}
