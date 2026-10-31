// One run as a card: what it is doing in plain words, a progress bar, and Cancel. When a run has
// stopped, the card says how it ended and offers Retry (if that can help) and Dismiss.
// Spec: PRD R1, R4 and "Runs never block the app", ARCHITECTURE.md section 10.
import type { Run } from "@jobgoblin/schemas";
import { useTranslation } from "react-i18next";
import { useCancelRun, useDismissRun, useRetryRun } from "@/api/runs";
import { ErrorNotice } from "./ErrorNotice";
import { Button } from "./ui/Button";
import { ProgressBar } from "./ui/ProgressBar";

const RETRYABLE_STATUSES: readonly Run["status"][] = ["failed", "blocked", "interrupted"];

type RunCardProps = {
  run: Run;
  headingLevel?: 2 | 3;
  // Called with the new run when the person presses Retry (a retry is a new run with a new id).
  onRetried?: (newRun: Run) => void;
};

export function RunCard({ run, headingLevel = 3, onRetried }: RunCardProps) {
  const { t } = useTranslation();
  const cancelRun = useCancelRun();
  const retryRun = useRetryRun();
  const dismissRun = useDismissRun();

  const Heading = headingLevel === 2 ? "h2" : "h3";
  const title = t(`common:run.kind.${run.kind}`);
  const isActive = run.status === "queued" || run.status === "running";
  const canRetry = RETRYABLE_STATUSES.includes(run.status);

  function describeActiveStep(): string {
    if (run.step !== null) return run.step;
    return run.status === "queued" ? t("common:run.status.queued") : t("common:run.starting");
  }

  return (
    <article data-testid="run-card" aria-label={title} className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Heading className="text-sm font-semibold">{title}</Heading>
          {/* A polite live region: a screen reader reads each new step when it has finished its sentence. */}
          <p role="status" className="mt-1 text-sm text-muted">
            {isActive ? describeActiveStep() : (run.outcomeMessage ?? t(`common:run.status.${run.status}`))}
          </p>
        </div>

        <div className="flex gap-2">
          {isActive && (
            <Button
              size="small"
              aria-label={t("common:run.cancelLabel", { title })}
              disabled={cancelRun.isPending}
              onClick={() => cancelRun.mutate(run.id)}
            >
              {t("common:actions.cancel")}
            </Button>
          )}
          {canRetry && (
            <Button
              size="small"
              aria-label={t("common:run.retryLabel", { title })}
              disabled={retryRun.isPending}
              onClick={() => retryRun.mutate(run.id, { onSuccess: onRetried })}
            >
              {t("common:actions.tryAgain")}
            </Button>
          )}
          {!isActive && (
            <Button
              variant="ghost"
              size="small"
              aria-label={t("common:run.dismissLabel", { title })}
              disabled={dismissRun.isPending}
              onClick={() => dismissRun.mutate(run.id)}
            >
              {t("common:actions.dismiss")}
            </Button>
          )}
        </div>
      </div>

      {isActive && (
        <div className="mt-3 space-y-1">
          <ProgressBar value={run.progressDone} max={run.progressTotal} label={title} />
          {run.progressTotal !== null && (
            <p className="text-xs text-muted">
              {t("common:run.progress", { done: run.progressDone, total: run.progressTotal })}
            </p>
          )}
        </div>
      )}

      <ErrorNotice className="mt-3" error={cancelRun.error ?? retryRun.error ?? dismissRun.error} />
    </article>
  );
}
