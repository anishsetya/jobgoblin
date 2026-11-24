// The Needs you list: everything waiting on the person, in one place (PRD "One place for anything that
// needs the person"). Each item says what it is and offers the one next step; a question carries its own answer box.
// A run that stopped offers what the server says helps (nextStep): Try again, or Check settings when only Settings
// can fix it (Claude Code missing, too old or signed out). PRD R2.
// Titles name a role and a company from a posting, so a word longer than the line is broken (wrap-anywhere).
import type { NeedsYouItem } from "@jobgoblin/schemas";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useRetryRun } from "@/api/runs";
import { ErrorNotice } from "./ErrorNotice";
import { QuestionAnswerForm } from "./QuestionAnswerForm";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";

type ItemActionProps = {
  item: NeedsYouItem;
  onTryAgain: () => void;
  isTryingAgain: boolean;
};

// Where the button of each kind of item leads.
function ItemAction({ item, onTryAgain, isTryingAgain }: ItemActionProps) {
  const { t } = useTranslation();
  const label = t(`today:needsYou.action.${item.kind}`);
  const applicationId = item.applicationId;

  if (item.kind === "question") return null; // the answer box is the action
  if (item.kind === "run-attention") {
    if (item.nextStep === "try-again" && item.runId !== null) {
      return (
        <Button size="small" aria-label={t("common:run.retryLabel", { title: item.title })} disabled={isTryingAgain} onClick={onTryAgain}>
          {t("common:actions.tryAgain")}
        </Button>
      );
    }
    return (
      <Button asChild size="small">
        <Link to="/settings">{label}</Link>
      </Button>
    );
  }
  if (applicationId === null) return null; // every other kind is about one application
  if (item.kind === "review") {
    return (
      <Button asChild size="small">
        <Link to="/review/$id" params={{ id: applicationId }}>
          {label}
        </Link>
      </Button>
    );
  }
  if (item.kind === "ready-to-submit") {
    return (
      <Button asChild size="small">
        <Link to="/apply/$id" params={{ id: applicationId }}>
          {label}
        </Link>
      </Button>
    );
  }
  // long-shot, not-tailored and follow-up-due all lead to the application's own page.
  return (
    <Button asChild size="small">
      <Link to="/apps/$id" params={{ id: applicationId }}>
        {label}
      </Link>
    </Button>
  );
}

function NeedsYouEntry({ item }: { item: NeedsYouItem }) {
  const { t } = useTranslation();
  const retryRun = useRetryRun(); // only a "run-attention" item uses it

  return (
    <li data-testid="needs-you-item" className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Badge>{t(`today:needsYou.kind.${item.kind}`)}</Badge>
          <h3 className="text-sm font-semibold wrap-anywhere">{item.title}</h3>
          {item.kind !== "question" && <p className="text-sm text-muted wrap-anywhere">{item.detail}</p>}
        </div>
        <ItemAction
          item={item}
          onTryAgain={() => {
            if (item.runId !== null) retryRun.mutate(item.runId);
          }}
          isTryingAgain={retryRun.isPending}
        />
      </div>
      {/* Needs: the schema does not say what NeedsYouItem.id holds. For kind "question" it is assumed to be the
          question's id (what POST /api/questions/:id/answer takes) and `detail` its text. */}
      {item.kind === "question" && <QuestionAnswerForm questionId={item.id} questionText={item.detail} />}
      <ErrorNotice className="mt-3" error={retryRun.error} />
    </li>
  );
}

export function NeedsYouList({ items }: { items: NeedsYouItem[] }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <NeedsYouEntry key={`${item.kind}-${item.id}`} item={item} />
      ))}
    </ul>
  );
}
