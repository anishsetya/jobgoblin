// How well a job fits: the score and band, the one-line reason, the risks (flags, in amber), the gaps,
// and the parts of Your story that support the fit. Spec: PRD F1, F2 and "Review".
import type { Fit, StoryItem } from "@jobgoblin/schemas";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BandBadge } from "./BandBadge";
import { Badge } from "./ui/Badge";
import { Card } from "./ui/Card";

type FitSummaryProps = {
  fit: Fit | null;
  // The story items the server sent with the application; the ones the fit matched are shown by name.
  storyItems: StoryItem[];
};

function BulletList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-sm font-medium">{title}</h3>
      <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function FitSummary({ fit, storyItems }: FitSummaryProps) {
  const { t } = useTranslation();

  if (fit === null) {
    return (
      <Card title={t("common:fit.title")}>
        <p className="text-sm text-muted">{t("common:fit.notScored")}</p>
      </Card>
    );
  }

  const matchedTexts = storyItems.filter((item) => fit.matchedItemIds.includes(item.id)).map((item) => item.data.text);

  return (
    <Card title={t("common:fit.title")}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-3xl font-semibold" aria-label={t("common:fit.scoreLabel", { score: fit.score })}>
            {fit.score}
            <span aria-hidden="true" className="ml-1 text-sm font-normal text-muted">
              / 100
            </span>
          </p>
          <BandBadge band={fit.band} />
        </div>

        <p className="text-sm">{fit.reason}</p>

        {fit.hardSkip !== null && (
          <p className="text-sm text-flag">{t("common:fit.hardSkip", { reason: fit.hardSkip })}</p>
        )}

        {fit.flags.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-medium">{t("common:fit.flags")}</h3>
            <ul className="flex flex-wrap gap-2">
              {fit.flags.map((flag) => (
                <li key={flag}>
                  <Badge tone="amber">
                    <TriangleAlert aria-hidden="true" className="size-3" />
                    {flag}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}

        <BulletList title={t("common:fit.gaps")} items={fit.gaps} />
        <BulletList title={t("common:fit.matched")} items={matchedTexts} />
      </div>
    </Card>
  );
}
