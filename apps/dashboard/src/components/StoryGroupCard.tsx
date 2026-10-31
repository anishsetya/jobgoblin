// An experience or project with its achievements under it, as one panel. "Confirm all" confirms every
// item in the panel that is still waiting, so a person who agrees with a whole job does not click it ten times.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfirmStoryItem } from "@/api/story";
import type { StoryGroup } from "@/lib/storyGroups";
import { ErrorNotice } from "./ErrorNotice";
import { StoryItemCard } from "./StoryItemCard";
import { Button } from "./ui/Button";

type StoryGroupCardProps = {
  group: StoryGroup;
  // The achievements to list. In the setup wizard this is only the ones still waiting.
  visibleChildren: StoryGroup["children"];
};

export function StoryGroupCard({ group, visibleChildren }: StoryGroupCardProps) {
  const { t } = useTranslation();
  const confirmItem = useConfirmStoryItem();
  const [confirmError, setConfirmError] = useState<unknown>(null);

  const waitingItems = [group.parent, ...group.children].filter((item) => item.status === "pending");

  async function confirmAll(): Promise<void> {
    setConfirmError(null);
    try {
      await Promise.all(waitingItems.map((item) => confirmItem.mutateAsync(item.id)));
    } catch (error) {
      setConfirmError(error);
    }
  }

  return (
    <li className="rounded-lg border border-line bg-surface">
      <div className="p-4">
        <StoryItemCard item={group.parent} />
      </div>

      {visibleChildren.length > 0 && (
        <ul className="divide-y divide-line border-t border-line">
          {visibleChildren.map((child) => (
            <li key={child.id} className="py-3 pr-4 pl-8">
              <StoryItemCard item={child} />
            </li>
          ))}
        </ul>
      )}

      {waitingItems.length > 1 && (
        <div className="space-y-2 border-t border-line p-3">
          <Button size="small" disabled={confirmItem.isPending} onClick={() => void confirmAll()}>
            {t("common:story.confirmAll", { count: waitingItems.length })}
          </Button>
          <ErrorNotice error={confirmError} />
        </div>
      )}
    </li>
  );
}
