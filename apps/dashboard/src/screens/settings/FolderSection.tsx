// Settings > Your folder: where the person's resumes, application folders and tracker files live, with a button to
// open it and one to choose another. If the new folder already holds backups, they are offered for Restore.
// Spec: PRD S4. The app's own working data folder is shown read-only (it is not a setting).
import type { Backup, SettingsResponse } from "@jobgoblin/schemas";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOpenPath } from "@/api/settings";
import { BackupList } from "@/components/BackupList";
import { ErrorNotice } from "@/components/ErrorNotice";
import { FolderChooser } from "@/components/FolderChooser";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export function FolderSection({ settings }: { settings: SettingsResponse }) {
  const { t } = useTranslation();
  const openPath = useOpenPath();
  const [backupsFound, setBackupsFound] = useState<Backup[]>([]);

  return (
    <Card title={t("settings:folder.title")} description={t("settings:folder.description")}>
      <div className="space-y-5">
        <FolderChooser currentFolder={settings.personFolder} onChosen={(response) => setBackupsFound(response.backupsFound)} />

        {settings.personFolder !== null && (
          <div className="space-y-2">
            <Button onClick={() => openPath.mutate(settings.personFolder ?? "")}>{t("settings:folder.open")}</Button>
            {openPath.data?.opened === false && (
              <p role="status" className="text-sm text-muted">
                {t("settings:folder.notOpened", { path: openPath.data.path })}
              </p>
            )}
            <ErrorNotice error={openPath.error} />
          </div>
        )}

        {backupsFound.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">{t("settings:folder.backupsFound")}</h3>
            <BackupList backups={backupsFound} />
          </div>
        )}

        <p className="text-xs text-muted">{t("settings:folder.dataFolder", { path: settings.dataFolder })}</p>
      </div>
    </Card>
  );
}
