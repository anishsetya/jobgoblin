// Step 5: Your story. Claude drafted experiences, projects, achievements and skills from the resume; each one
// waits here for the person to keep it (Confirm), fix it (Edit) or remove it (Drop). Only confirmed items are
// ever used in a resume or a fit score. Spec: PRD P2.
import { useTranslation } from "react-i18next";
import { useStory } from "@/api/story";
import { EmptyState } from "@/components/EmptyState";
import { ErrorNotice } from "@/components/ErrorNotice";
import { LoadingNote } from "@/components/LoadingNote";
import { StoryList } from "@/components/StoryList";
import { SetupFrame } from "../SetupFrame";

export function StoryStep() {
  const { t } = useTranslation();
  const story = useStory();

  const items = story.data ?? [];
  const confirmedCount = items.filter((item) => item.status === "confirmed").length;
  const waitingCount = items.filter((item) => item.status === "pending").length;

  function renderStory() {
    if (story.isPending) return <LoadingNote />;
    if (story.isError) return <ErrorNotice error={story.error} onRetry={() => void story.refetch()} />;
    if (items.length === 0) {
      return <EmptyState title={t("setup:story.empty.title")} description={t("setup:story.empty.description")} />;
    }
    return waitingCount === 0 ? (
      <p role="status" className="text-sm text-success">
        {t("setup:story.allDone", { count: confirmedCount })}
      </p>
    ) : (
      <StoryList items={items} mode="pending" />
    );
  }

  return (
    <SetupFrame step={5} title={t("setup:story.title")} description={t("setup:story.description")} canContinue={confirmedCount > 0}>
      <div className="space-y-6">
        <p role="status" className="text-sm text-muted">
          {t("setup:story.counts", { confirmed: confirmedCount, waiting: waitingCount })}
        </p>
        {renderStory()}
      </div>
    </SetupFrame>
  );
}
