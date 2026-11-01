// The Review screen: role, company, fit, what changed, the resume, and the data that will be sent,
// then three choices. Approve is the only accent button on the screen. Keys: A approve, E request edit,
// S skip, J next and K previous among the applications waiting for review.
// Spec: PRD A1-A3 and "Interaction rules", ARCHITECTURE.md sections 8.5 and 12.
import type { ApplicationDetail } from "@jobgoblin/schemas";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useApproveApplication,
  useDownloadResumePdf,
  useRequestEdit,
  useSkipApplication,
} from "@/api/applications";
import { ApplicationHeader } from "@/components/ApplicationHeader";
import { BandBadge } from "@/components/BandBadge";
import { DataSheetTable } from "@/components/DataSheetTable";
import { ErrorNotice } from "@/components/ErrorNotice";
import { FitSummary } from "@/components/FitSummary";
import { RequestEditDialog } from "@/components/RequestEditDialog";
import { ResumeDiffSummary } from "@/components/ResumeDiffSummary";
import { ResumePreview } from "@/components/ResumePreview";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useKeyboardShortcuts } from "@/lib/keyboardShortcuts";
import { usePageTitle } from "@/lib/pageTitle";
import { useReviewQueue } from "./useReviewQueue";

export function ReviewContent({ detail }: { detail: ApplicationDetail }) {
  const { t } = useTranslation();
  const { application, job, fit, resume, resumeHeader, diff, storyItems, dataSheet, dataSheetHash, actions } = detail;
  const applicationId = application.id;
  usePageTitle(t("review:pageTitle", { company: application.company, title: application.title }));

  const approve = useApproveApplication(applicationId);
  const skip = useSkipApplication(applicationId);
  const requestEdit = useRequestEdit(applicationId);
  const downloadPdf = useDownloadResumePdf(applicationId);
  const [isNoteOpen, setIsNoteOpen] = useState(false);

  const { queueIds, positionInQueue, goToNeighbour, goToNextOrToday } = useReviewQueue(applicationId);

  const missingRequired = dataSheet?.fields.filter((field) => field.required && field.missing) ?? [];
  const canApproveNow = actions.canApprove && dataSheetHash !== null && missingRequired.length === 0;

  function approveApplication(): void {
    if (!canApproveNow || dataSheetHash === null || approve.isPending) return;
    approve.mutate(dataSheetHash, { onSuccess: goToNextOrToday });
  }

  function skipApplication(): void {
    if (!actions.canSkip || skip.isPending) return;
    skip.mutate(undefined, { onSuccess: goToNextOrToday });
  }

  function openNoteDialog(): void {
    if (actions.canRequestEdit) setIsNoteOpen(true);
  }

  function sendEditRequest(note: string): void {
    requestEdit.mutate(note, {
      onSuccess: () => {
        setIsNoteOpen(false);
        goToNextOrToday();
      },
    });
  }

  useKeyboardShortcuts(
    { a: approveApplication, e: openNoteDialog, s: skipApplication, j: () => goToNeighbour(1), k: () => goToNeighbour(-1) },
    !isNoteOpen,
  );

  const isWaitingForReview = actions.canApprove || actions.canSkip || actions.canRequestEdit;

  return (
    <div className="space-y-6">
      <ApplicationHeader
        title={application.title}
        company={application.company}
        job={job}
        eyebrow={positionInQueue === -1 ? undefined : t("review:position", { current: positionInQueue + 1, total: queueIds.length })}
        badges={fit === null ? undefined : <BandBadge band={fit.band} />}
      />

      {!isWaitingForReview && (
        <p className="rounded-md border border-line bg-surface p-3 text-sm">
          {t("review:notWaiting")}{" "}
          <Link to="/apps/$id" params={{ id: applicationId }} className="text-accent-text underline">
            {t("review:seeApplication")}
          </Link>
        </p>
      )}

      <section aria-label={t("review:decision.label")} className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="accent" disabled={!canApproveNow || approve.isPending} onClick={approveApplication}>
            {approve.isPending ? t("review:approving") : t("review:approve")}
          </Button>
          <Button disabled={!actions.canRequestEdit} onClick={openNoteDialog}>
            {t("review:requestEdit.open")}
          </Button>
          <Button disabled={!actions.canSkip || skip.isPending} onClick={skipApplication}>
            {t("review:skip")}
          </Button>
        </div>
        <p className="text-xs text-muted">{t("review:shortcuts")}</p>

        {missingRequired.length > 0 && (
          <p className="text-sm text-flag">
            {t("review:missingValues", { labels: missingRequired.map((field) => field.label).join(", ") })}{" "}
            <Link to="/profile/$tab" params={{ tab: "answers" }} className="underline">
              {t("review:addMissing")}
            </Link>
          </p>
        )}
        <ErrorNotice error={approve.error ?? skip.error ?? downloadPdf.error} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-6">
          <FitSummary fit={fit} storyItems={storyItems} />
          <ResumeDiffSummary diff={diff} storyItems={storyItems} />
          <Card title={t("review:dataSheet.title")} description={t("review:dataSheet.description")}>
            {dataSheet === null ? (
              <p className="text-sm text-muted">{t("review:dataSheet.none")}</p>
            ) : (
              <DataSheetTable dataSheet={dataSheet} showCopyButtons={false} />
            )}
          </Card>
        </div>

        <div className="min-w-0">
          <Card
            title={t("review:resume.title")}
            description={resume === null ? undefined : t("review:resume.version", { version: resume.shortId })}
            actions={
              resume === null ? undefined : (
                <Button
                  size="small"
                  disabled={downloadPdf.isPending}
                  onClick={() => downloadPdf.mutate({ versionId: resume.versionId, fileName: dataSheet?.resumeFileName ?? "Resume.pdf" })}
                >
                  {t("review:resume.downloadPdf")}
                </Button>
              )
            }
          >
            {resume === null ? (
              <p className="text-sm text-muted">{t("review:resume.none")}</p>
            ) : (
              <ResumePreview header={resumeHeader} body={resume.body} storyItems={storyItems} diff={diff} />
            )}
          </Card>
        </div>
      </div>

      <RequestEditDialog
        open={isNoteOpen}
        onOpenChange={setIsNoteOpen}
        onSend={sendEditRequest}
        isSending={requestEdit.isPending}
        error={requestEdit.error}
      />
    </div>
  );
}
