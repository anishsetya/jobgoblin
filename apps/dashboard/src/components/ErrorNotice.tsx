// Shows what went wrong and what to do next, in the server's own plain words (an ApiProblem).
// Renders nothing when there is no error, so a screen can always place it under a button:
//   <ErrorNotice error={approve.error} />
// Spec: PRD "Errors say what happened and what to do. No raw error text, no blame."
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ApiProblem } from "@/api/client";
import { cn } from "@/lib/cn";
import { Button } from "./ui/Button";

type ErrorNoticeProps = {
  error: unknown;
  onRetry?: () => void;
  className?: string;
};

export function ErrorNotice({ error, onRetry, className }: ErrorNoticeProps) {
  const { t } = useTranslation();
  if (error === null || error === undefined) return null;

  // Anything that is not an ApiProblem is a mistake in the dashboard itself. The person gets a calm
  // message; the details go to the console for whoever is debugging.
  const isKnownProblem = error instanceof ApiProblem;
  if (!isKnownProblem) console.error(error);
  const message = isKnownProblem ? error.message : t("common:errors.generic.message");
  const action = isKnownProblem ? error.action : t("common:errors.generic.action");

  return (
    <div
      role="alert"
      className={cn("flex items-start gap-3 rounded-md border border-line bg-danger-soft p-4 text-sm", className)}
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="space-y-1">
        <p className="font-medium text-danger">{message}</p>
        {action !== "" && <p className="text-text">{action}</p>}
        {onRetry !== undefined && (
          <Button variant="secondary" size="small" className="mt-2" onClick={onRetry}>
            {t("common:actions.tryAgain")}
          </Button>
        )}
      </div>
    </div>
  );
}
