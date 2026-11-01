// Settings > Tracker: the spreadsheet files Jobgoblin keeps up to date in the person's folder, with their
// status, a button to open the Excel file, and CSV / Excel downloads (which open in Google Sheets too).
// Spec: PRD K3, ARCHITECTURE.md section 7 (tracker.ts). "locked" means Excel has the file open.
import type { SettingsResponse } from "@jobgoblin/schemas";
import { useTranslation } from "react-i18next";
import { useDownloadExport, useOpenPath } from "@/api/settings";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { joinFolderPath } from "@/lib/paths";

// Needs: SettingsResponse could carry the tracker file's path. Until then it is assumed to sit directly in
// the person's folder under the name ARCHITECTURE.md section 7 gives (Tracker.xlsx).
const TRACKER_FILE_NAME = "Tracker.xlsx";

export function TrackerSection({ settings }: { settings: SettingsResponse }) {
  const { t } = useTranslation();
  const openPath = useOpenPath();
  const downloadExport = useDownloadExport();

  const { personFolder, trackerStatus } = settings;

  return (
    <Card title={t("settings:tracker.title")} description={t("settings:tracker.description")}>
      <div className="space-y-4">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={trackerStatus === "ok" ? "green" : "amber"}>{t(`settings:tracker.status.${trackerStatus}`)}</Badge>
          <span className="text-muted">{t(`settings:tracker.explain.${trackerStatus}`)}</span>
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            disabled={personFolder === null || openPath.isPending}
            onClick={() => personFolder !== null && openPath.mutate(joinFolderPath(personFolder, TRACKER_FILE_NAME))}
          >
            {t("settings:tracker.open")}
          </Button>
          <Button disabled={downloadExport.isPending} onClick={() => downloadExport.mutate("csv")}>
            {t("settings:tracker.exportCsv")}
          </Button>
          <Button disabled={downloadExport.isPending} onClick={() => downloadExport.mutate("xlsx")}>
            {t("settings:tracker.exportExcel")}
          </Button>
        </div>

        {openPath.data?.opened === false && (
          <p role="status" className="text-sm text-muted">
            {t("settings:tracker.notOpened", { path: openPath.data.path })}
          </p>
        )}
        <ErrorNotice error={openPath.error ?? downloadExport.error} />
      </div>
    </Card>
  );
}
