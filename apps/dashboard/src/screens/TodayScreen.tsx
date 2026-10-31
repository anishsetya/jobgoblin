// Today: the inbox that answers "what do I do now?". Find jobs and Add a job at the top, then what
// Needs you, what is Running (a card per run), and a small Done today summary.
// Spec: PRD "Screens: Today", ARCHITECTURE.md section 12. Live updates keep every part current.
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useStartHunt } from "@/api/runs";
import { useToday } from "@/api/today";
import { AddJobDialog } from "@/components/AddJobDialog";
import { EmptyState } from "@/components/EmptyState";
import { ErrorNotice } from "@/components/ErrorNotice";
import { LoadingNote } from "@/components/LoadingNote";
import { NeedsYouList } from "@/components/NeedsYouList";
import { RunCard } from "@/components/RunCard";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useUsageNotice } from "@/components/useUsageNotice";
import { usePageTitle } from "@/lib/pageTitle";

export function TodayScreen() {
  const { t } = useTranslation();
  usePageTitle(t("today:title"));

  const today = useToday();
  const startHunt = useStartHunt();
  const { runAfterNotice, usageNotice } = useUsageNotice();
  const [isAddJobOpen, setIsAddJobOpen] = useState(false);
  const [addedMessage, setAddedMessage] = useState<string | null>(null);

  if (today.isPending) return <LoadingNote />;
  if (today.isError) return <ErrorNotice error={today.error} onRetry={() => void today.refetch()} />;

  const { needsYou, running, doneToday, setupComplete } = today.data;

  if (!setupComplete) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">{t("today:title")}</h1>
        <EmptyState
          title={t("today:setupIncomplete.title")}
          description={t("today:setupIncomplete.description")}
          action={
            <Button asChild variant="accent">
              <Link to="/setup/$step" params={{ step: "1" }}>
                {t("today:setupIncomplete.action")}
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  // Finding jobs twice at once would only compete for the same plan limits.
  const isHuntActive = running.some((run) => run.kind === "hunt" && (run.status === "queued" || run.status === "running"));
  const isFreshStart =
    needsYou.length === 0 &&
    running.length === 0 &&
    doneToday.found + doneToday.tailored + doneToday.approved + doneToday.applied === 0;

  const findJobsButton = (
    <Button variant="accent" disabled={isHuntActive || startHunt.isPending} onClick={() => runAfterNotice(() => startHunt.mutate())}>
      {t("today:findJobs")}
    </Button>
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("today:title")}</h1>
        <div className="flex flex-wrap gap-2">
          {!isFreshStart && findJobsButton}
          <Button
            onClick={() => {
              setAddedMessage(null);
              runAfterNotice(() => setIsAddJobOpen(true));
            }}
          >
            {t("today:addJob.open")}
          </Button>
        </div>
      </div>

      <ErrorNotice error={startHunt.error} />
      {addedMessage !== null && (
        <p role="status" className="rounded-md border border-line bg-surface p-3 text-sm">
          {addedMessage}
        </p>
      )}

      {isFreshStart ? (
        <EmptyState
          title={t("today:fresh.title")}
          description={t("today:fresh.description")}
          action={findJobsButton}
        />
      ) : (
        <>
          <section aria-labelledby="needs-you-heading" className="space-y-3">
            <h2 id="needs-you-heading" className="text-lg font-semibold">
              {t("today:needsYou.title")}
            </h2>
            {needsYou.length > 0 ? (
              <NeedsYouList items={needsYou} />
            ) : (
              <p className="text-sm text-muted">{t("today:needsYou.empty")}</p>
            )}
          </section>

          {running.length > 0 && (
            <section aria-labelledby="running-heading" className="space-y-3">
              <h2 id="running-heading" className="text-lg font-semibold">
                {t("today:running.title")}
              </h2>
              <div className="space-y-3">
                {running.map((run) => (
                  <RunCard key={run.id} run={run} />
                ))}
              </div>
            </section>
          )}

          <Card title={t("today:done.title")}>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {(["found", "tailored", "approved", "applied"] as const).map((measure) => (
                <div key={measure}>
                  <dt className="text-sm text-muted">{t(`today:done.${measure}`)}</dt>
                  <dd className="text-2xl font-semibold">{doneToday[measure]}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </>
      )}

      <AddJobDialog open={isAddJobOpen} onOpenChange={setIsAddJobOpen} onAdded={setAddedMessage} />
      {usageNotice}
    </div>
  );
}
