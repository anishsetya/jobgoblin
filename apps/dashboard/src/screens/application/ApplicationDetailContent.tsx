// One application in full: its status and follow-up day, the buttons that apply right now, the job description,
// fit, resume versions, answers, status history, a status change form, and "Ask about this application".
// Spec: PRD "Screens: Application detail", K2 and T2, ARCHITECTURE.md section 12 (/apps/:id).
import type { ApplicationDetail } from "@jobgoblin/schemas";
import { useTranslation } from "react-i18next";
import { ApplicationHeader } from "@/components/ApplicationHeader";
import { BandBadge } from "@/components/BandBadge";
import { CopyButton } from "@/components/CopyButton";
import { FitSummary } from "@/components/FitSummary";
import { HistoryList } from "@/components/HistoryList";
import { JobText } from "@/components/JobText";
import { QuestionAnswerForm } from "@/components/QuestionAnswerForm";
import { StatusBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/Card";
import { formatDay } from "@/lib/format";
import { usePageTitle } from "@/lib/pageTitle";
import { ApplicationActionBar } from "./ApplicationActionBar";
import { AskCard } from "./AskCard";
import { ResumeVersionsCard } from "./ResumeVersionsCard";
import { StatusChangeCard } from "./StatusChangeCard";

export function ApplicationDetailContent({ detail }: { detail: ApplicationDetail }) {
  const { t } = useTranslation();
  const { application, job, fit, storyItems, answers, questions, history, askResults, allowedStatusMoves, actions } = detail;
  usePageTitle(`${application.title} - ${application.company}`);

  const openQuestions = questions.filter((question) => question.answer === null);

  return (
    <div className="space-y-6">
      <ApplicationHeader
        title={application.title}
        company={application.company}
        job={job}
        badges={
          <>
            <StatusBadge status={application.status} />
            {application.band !== null && <BandBadge band={application.band} />}
            {application.followUpOn !== null && (
              <span>{t("application:followUp", { date: formatDay(application.followUpOn) })}</span>
            )}
          </>
        }
      />

      {application.tailorError !== null && (
        <p role="status" className="rounded-md border border-flag-line bg-flag-soft p-3 text-sm text-flag">
          {application.tailorError}
        </p>
      )}

      <ApplicationActionBar detail={detail} />

      {openQuestions.length > 0 && (
        <Card title={t("application:questions.title")} description={t("application:questions.description")}>
          <div className="space-y-4">
            {openQuestions.map((question) => (
              <QuestionAnswerForm key={question.id} questionId={question.id} questionText={question.text} />
            ))}
          </div>
        </Card>
      )}

      <FitSummary fit={fit} storyItems={storyItems} />

      <Card title={t("application:jobText.title")}>
        {job.text === "" ? <p className="text-sm text-muted">{t("application:jobText.none")}</p> : <JobText text={job.text} />}
      </Card>

      <ResumeVersionsCard detail={detail} />

      <Card title={t("application:answers.title")}>
        {answers.length === 0 ? (
          <p className="text-sm text-muted">{t("application:answers.none")}</p>
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
      </Card>

      <StatusChangeCard applicationId={application.id} allowedMoves={allowedStatusMoves} />

      <AskCard applicationId={application.id} canAsk={actions.canAsk} results={askResults} />

      <Card title={t("application:history.title")}>
        {history.length === 0 ? <p className="text-sm text-muted">{t("application:history.none")}</p> : <HistoryList events={history} />}
      </Card>
    </div>
  );
}
