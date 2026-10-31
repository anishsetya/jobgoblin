// Open application: the posting link, a copy button for every field of the FROZEN data sheet the person
// approved and for every answer, the approved resume file, and "I submitted" with proof.
// The person fills in the company's form themselves and clicks Submit there; Jobgoblin never does.
// If the profile changed after approval, the approval is void and the screen asks for another review.
// Spec: PRD U1 and U4, ARCHITECTURE.md sections 8.5, 8.6 and 12.
import type { ApplicationDetail } from "@jobgoblin/schemas";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApplicationHeader } from "@/components/ApplicationHeader";
import { CopyButton } from "@/components/CopyButton";
import { DataSheetTable } from "@/components/DataSheetTable";
import { EmptyState } from "@/components/EmptyState";
import { QuestionAnswerForm } from "@/components/QuestionAnswerForm";
import { ResumeFileCard } from "@/components/ResumeFileCard";
import { StatusBadge } from "@/components/StatusBadge";
import { SubmittedDialog } from "@/components/SubmittedDialog";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { usePageTitle } from "@/lib/pageTitle";

export function ApplyContent({ detail }: { detail: ApplicationDetail }) {
  const { t } = useTranslation();
  const { application, job, approval, answers, questions, versions, actions } = detail;
  usePageTitle(t("apply:pageTitle", { company: application.company, title: application.title }));

  const navigate = useNavigate();
  const [isSubmittedOpen, setIsSubmittedOpen] = useState(false);

  const header = (
    <ApplicationHeader
      eyebrow={t("apply:eyebrow")}
      title={application.title}
      company={application.company}
      job={job}
      badges={<StatusBadge status={application.status} />}
    />
  );

  if (approval === null) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          title={t("apply:notApproved.title")}
          description={t("apply:notApproved.description")}
          action={
            <Button asChild>
              <Link to="/apps/$id" params={{ id: application.id }}>
                {t("apply:seeApplication")}
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  // A change to the person's details after approval voids it (ARCHITECTURE.md section 8.5).
  if (approval.voidedAt !== null) {
    return (
      <div className="space-y-6">
        {header}
        <div role="alert" className="space-y-3 rounded-lg border border-flag-line bg-flag-soft p-5 text-flag">
          <h2 className="text-base font-semibold">{t("apply:voided.title")}</h2>
          <p className="text-sm">{t("apply:voided.description")}</p>
          <Button asChild variant="accent">
            <Link to="/review/$id" params={{ id: application.id }}>
              {t("apply:voided.action")}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const openQuestions = questions.filter((question) => question.answer === null);
  const approvedVersion = versions.find((version) => version.versionId === approval.resumeVersion);
  const isAlreadySubmitted = approval.usedAt !== null;

  return (
    <div className="space-y-6">
      {header}

      {isAlreadySubmitted && (
        <p className="rounded-md border border-line bg-surface p-3 text-sm">
          {t("apply:alreadySubmitted")}{" "}
          <Link to="/apps/$id" params={{ id: application.id }} className="text-accent-text underline">
            {t("apply:seeApplication")}
          </Link>
        </p>
      )}

      <p className="text-sm text-muted">{t("apply:intro")}</p>

      <ResumeFileCard
        applicationId={application.id}
        applicationFolder={application.folder}
        fileName={approval.dataSheet.resumeFileName}
        versionId={approval.resumeVersion}
        shortId={approvedVersion?.shortId ?? null}
      />

      <Card title={t("apply:dataSheet.title")} description={t("apply:dataSheet.description")}>
        <DataSheetTable dataSheet={approval.dataSheet} showCopyButtons />
      </Card>

      <Card title={t("apply:answers.title")} description={t("apply:answers.description")}>
        {answers.length === 0 ? (
          <p className="text-sm text-muted">{t("apply:answers.none")}</p>
        ) : (
          <ul className="space-y-5">
            {answers.map((answer) => (
              <li key={answer.question} className="space-y-1">
                <h3 className="text-sm font-medium">{answer.question}</h3>
                <p className="text-sm whitespace-pre-wrap">{answer.answer}</p>
                <CopyButton text={answer.answer} label={answer.question} />
              </li>
            ))}
          </ul>
        )}
        {openQuestions.length > 0 && (
          <div className="mt-6 space-y-2 border-t border-line pt-4">
            <h3 className="text-sm font-medium">{t("apply:answers.questionsTitle")}</h3>
            {openQuestions.map((question) => (
              <QuestionAnswerForm key={question.id} questionId={question.id} questionText={question.text} />
            ))}
          </div>
        )}
      </Card>

      {!isAlreadySubmitted && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="accent" disabled={!actions.canMarkSubmitted} onClick={() => setIsSubmittedOpen(true)}>
            {t("apply:submitted.open")}
          </Button>
          <p className="text-sm text-muted">{t("apply:submitted.openHint")}</p>
        </div>
      )}

      <SubmittedDialog
        open={isSubmittedOpen}
        onOpenChange={setIsSubmittedOpen}
        approval={approval}
        onSubmitted={() => void navigate({ to: "/apps/$id", params: { id: application.id } })}
      />
    </div>
  );
}
