// What changed in this resume compared with the person's main (master) resume: lines added or removed,
// whether the order changed, and every reworded line side by side. The diff holds story item ids,
// so the text of each line is looked up in the story items the server sent along.
// Spec: PRD A1 ("changes versus the master resume"), ARCHITECTURE.md section 5.6 (ResumeDiff).
import type { ResumeDiff, StoryItem } from "@jobgoblin/schemas";
import { useTranslation } from "react-i18next";
import { Card } from "./ui/Card";

type ResumeDiffSummaryProps = {
  diff: ResumeDiff | null;
  storyItems: StoryItem[];
};

function IdList({ title, ids, itemsById }: { title: string; ids: string[]; itemsById: Map<string, StoryItem> }) {
  const { t } = useTranslation();
  if (ids.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-sm font-medium">{title}</h3>
      <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted">
        {ids.map((id) => (
          <li key={id}>{itemsById.get(id)?.data.text ?? t("common:diff.unknownLine")}</li>
        ))}
      </ul>
    </div>
  );
}

export function ResumeDiffSummary({ diff, storyItems }: ResumeDiffSummaryProps) {
  const { t } = useTranslation();
  const itemsById = new Map(storyItems.map((item) => [item.id, item]));

  if (diff === null) {
    return (
      <Card title={t("common:diff.title")}>
        <p className="text-sm text-muted">{t("common:diff.none")}</p>
      </Card>
    );
  }

  const hasNoChanges =
    diff.added.length === 0 && diff.removed.length === 0 && diff.reworded.length === 0 && !diff.reordered;

  return (
    <Card title={t("common:diff.title")} description={t("common:diff.description")}>
      <div className="space-y-4">
        {hasNoChanges && <p className="text-sm text-muted">{t("common:diff.same")}</p>}
        <IdList title={t("common:diff.added")} ids={diff.added} itemsById={itemsById} />
        <IdList title={t("common:diff.removed")} ids={diff.removed} itemsById={itemsById} />
        {diff.reordered && <p className="text-sm text-muted">{t("common:diff.reordered")}</p>}
        {diff.reworded.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-medium">{t("common:diff.reworded")}</h3>
            <ul className="space-y-3">
              {diff.reworded.map((line) => (
                <li key={line.src} className="text-sm">
                  <p className="text-muted">
                    <span className="font-medium">{t("common:diff.before")}</span> {line.from}
                  </p>
                  <p>
                    <span className="font-medium">{t("common:diff.after")}</span> {line.to}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
