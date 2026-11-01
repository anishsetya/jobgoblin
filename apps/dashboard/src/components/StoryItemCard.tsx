// One item of Your story with what the person can do to it: Confirm (it may now appear in resumes and fit
// scores), Edit (opens the form in place), or Drop (it is never used). Spec: PRD P2.
import type { StoryItem } from "@jobgoblin/schemas";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfirmStoryItem, useRejectStoryItem } from "@/api/story";
import { formatStoryDateRange } from "@/lib/format";
import { summaryOf } from "@/lib/storyGroups";
import { ErrorNotice } from "./ErrorNotice";
import { StoryItemForm } from "./StoryItemForm";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";

// The line of detail under an experience, project or education item: where, and when.
function describeWhereAndWhen(item: StoryItem): string {
  const { data } = item;
  const dates = formatStoryDateRange(data.startDate, data.endDate);
  return [data.organization, data.location, dates].filter((part) => part !== undefined && part !== "").join(" | ");
}

export function StoryItemCard({ item }: { item: StoryItem }) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const confirmItem = useConfirmStoryItem();
  const rejectItem = useRejectStoryItem();

  const name = summaryOf(item);
  const isPending = item.status === "pending";
  const hasHeading = item.kind === "experience" || item.kind === "project" || item.kind === "education";
  const detail = hasHeading ? describeWhereAndWhen(item) : "";

  if (isEditing) {
    return <StoryItemForm item={item} onDone={() => setIsEditing(false)} />;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{t(`common:story.kind.${item.kind}`)}</Badge>
            <Badge tone={isPending ? "amber" : "green"}>{t(`common:story.status.${item.status}`)}</Badge>
          </div>
          <p className={hasHeading ? "text-sm font-semibold" : "text-sm"}>{hasHeading ? name : item.data.text}</p>
          {detail !== "" && <p className="text-sm text-muted">{detail}</p>}
          {item.data.tools.length > 0 && (
            <p className="text-xs text-muted">{t("common:story.tools", { tools: item.data.tools.join(", ") })}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {isPending && (
            <Button
              size="small"
              aria-label={t("common:story.confirmLabel", { name })}
              disabled={confirmItem.isPending}
              onClick={() => confirmItem.mutate(item.id)}
            >
              {t("common:actions.confirm")}
            </Button>
          )}
          <Button size="small" variant="ghost" aria-label={t("common:story.editLabel", { name })} onClick={() => setIsEditing(true)}>
            {t("common:actions.edit")}
          </Button>
          <Button
            size="small"
            variant="danger-quiet"
            aria-label={t("common:story.dropLabel", { name })}
            disabled={rejectItem.isPending}
            onClick={() => rejectItem.mutate(item.id)}
          >
            {t("common:actions.drop")}
          </Button>
        </div>
      </div>
      <ErrorNotice error={confirmItem.error ?? rejectItem.error} />
    </div>
  );
}
