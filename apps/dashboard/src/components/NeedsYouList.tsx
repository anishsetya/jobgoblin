// The Needs you list: everything waiting on the person, in one place (PRD "One place for anything that
// needs the person"). Each item says what it is and offers the one next step; a question carries its own answer box.
import type { NeedsYouItem } from "@jobgoblin/schemas";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { QuestionAnswerForm } from "./QuestionAnswerForm";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";

// Where the button of each kind of item leads.
function ItemAction({ item }: { item: NeedsYouItem }) {
  const { t } = useTranslation();
  const label = t(`today:needsYou.action.${item.kind}`);
  const applicationId = item.applicationId;

  if (item.kind === "question") return null; // the answer box is the action
  if (item.kind === "run-attention" || applicationId === null) {
    return (
      <Button asChild size="small">
        <Link to="/settings">{label}</Link>
      </Button>
    );
  }
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

export function NeedsYouList({ items }: { items: NeedsYouItem[] }) {
  const { t } = useTranslation();

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={`${item.kind}-${item.id}`} data-testid="needs-you-item" className="rounded-lg border border-line bg-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <Badge>{t(`today:needsYou.kind.${item.kind}`)}</Badge>
              <h3 className="text-sm font-semibold">{item.title}</h3>
              {item.kind !== "question" && <p className="text-sm text-muted">{item.detail}</p>}
            </div>
            <ItemAction item={item} />
          </div>
          {/* Needs: the schema does not say what NeedsYouItem.id holds. For kind "question" it is assumed to be the
              question's id (what POST /api/questions/:id/answer takes) and `detail` its text. */}
          {item.kind === "question" && <QuestionAnswerForm questionId={item.id} questionText={item.detail} />}
        </li>
      ))}
    </ul>
  );
}
