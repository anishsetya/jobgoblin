// Every resume this application has used: its short id, whether it is still a draft or approved (frozen),
// when it was made, and a button to save the PDF. The approved one is exactly the file the company gets.
// Spec: PRD T2 ("Each resume gets a version id").
import type { ApplicationDetail } from "@jobgoblin/schemas";
import { useTranslation } from "react-i18next";
import { useDownloadResumePdf } from "@/api/applications";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatMoment } from "@/lib/format";

export function ResumeVersionsCard({ detail }: { detail: ApplicationDetail }) {
  const { t } = useTranslation();
  const { application, versions, dataSheet } = detail;
  const downloadPdf = useDownloadResumePdf(application.id);

  return (
    <Card title={t("application:versions.title")}>
      {versions.length === 0 ? (
        <p className="text-sm text-muted">{t("application:versions.none")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {versions.map((version) => {
            const isCurrent = version.versionId === application.resumeVersion;
            const fileName =
              version.state === "approved" && dataSheet !== null
                ? dataSheet.resumeFileName
                : t("application:versions.draftFileName", { version: version.shortId });
            return (
              <li key={version.versionId} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="space-y-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {version.shortId}
                    <Badge tone={version.state === "approved" ? "green" : "neutral"}>
                      {t(`application:versions.state.${version.state}`)}
                    </Badge>
                    {isCurrent && <Badge>{t("application:versions.current")}</Badge>}
                  </p>
                  <p className="text-xs text-muted">{formatMoment(version.createdAt)}</p>
                </div>
                <Button
                  size="small"
                  aria-label={t("application:versions.downloadLabel", { version: version.shortId })}
                  disabled={downloadPdf.isPending}
                  onClick={() => downloadPdf.mutate({ versionId: version.versionId, fileName })}
                >
                  {t("application:versions.download")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <ErrorNotice className="mt-3" error={downloadPdf.error} />
    </Card>
  );
}
