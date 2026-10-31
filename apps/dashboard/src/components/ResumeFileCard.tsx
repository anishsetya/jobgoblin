// The approved resume file, with the buttons to use it: "Open resume file" opens the copy in the person's own
// folder (the one to attach to the company's form), and "Download a copy" saves it from Jobgoblin if the file
// cannot be opened. Spec: PRD U1 ("the approved resume file"), T2 ("the exact approved file").
import { useTranslation } from "react-i18next";
import { useDownloadResumePdf } from "@/api/applications";
import { useOpenPath, useSettings } from "@/api/settings";
import { joinFolderPath } from "@/lib/paths";
import { ErrorNotice } from "./ErrorNotice";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

type ResumeFileCardProps = {
  applicationId: string;
  // The application's folder, relative to the person's folder. Null until the application is approved.
  applicationFolder: string | null;
  fileName: string; // "First Last - Resume.pdf": the name the company will see
  versionId: string;
  shortId: string | null;
};

export function ResumeFileCard({ applicationId, applicationFolder, fileName, versionId, shortId }: ResumeFileCardProps) {
  const { t } = useTranslation();
  const settings = useSettings();
  const openPath = useOpenPath();
  const downloadPdf = useDownloadResumePdf(applicationId);

  const personFolder = settings.data?.personFolder ?? null;
  const canOpenFile = personFolder !== null && applicationFolder !== null;

  function openResumeFile(): void {
    if (personFolder === null || applicationFolder === null) return;
    openPath.mutate(joinFolderPath(personFolder, applicationFolder, fileName));
  }

  return (
    <Card title={t("apply:resume.title")} description={shortId === null ? undefined : t("apply:resume.version", { version: shortId })}>
      <div className="space-y-3">
        <p className="text-sm">
          {t("apply:resume.fileName")} <span className="font-medium">{fileName}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!canOpenFile || openPath.isPending} onClick={openResumeFile}>
            {t("apply:resume.open")}
          </Button>
          <Button
            variant="ghost"
            disabled={downloadPdf.isPending}
            onClick={() => downloadPdf.mutate({ versionId, fileName })}
          >
            {t("apply:resume.download")}
          </Button>
        </div>

        {openPath.data?.opened === false && (
          <p role="status" className="text-sm text-muted">
            {t("apply:resume.notOpened")} <span className="font-medium break-all">{openPath.data.path}</span>
          </p>
        )}
        <ErrorNotice error={openPath.error ?? downloadPdf.error} />
      </div>
    </Card>
  );
}
