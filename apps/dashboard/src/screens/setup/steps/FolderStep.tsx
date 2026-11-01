// Step 3: choose the folder for the person's files. If the folder already holds backups (a new computer, or
// a fresh install), they are offered for Restore, which brings everything back and skips the rest of setup.
import type { Backup } from "@jobgoblin/schemas";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/api/settings";
import { BackupList } from "@/components/BackupList";
import { FolderChooser } from "@/components/FolderChooser";
import { Card } from "@/components/ui/Card";
import { SetupFrame } from "../SetupFrame";

export function FolderStep() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const settings = useSettings();
  const [backupsFound, setBackupsFound] = useState<Backup[]>([]);

  const currentFolder = settings.data?.personFolder ?? null;

  return (
    <SetupFrame step={3} title={t("setup:folder.title")} description={t("setup:folder.description")} canContinue={currentFolder !== null}>
      <div className="space-y-6">
        <FolderChooser currentFolder={currentFolder} onChosen={(response) => setBackupsFound(response.backupsFound)} />

        {backupsFound.length > 0 && (
          <Card title={t("setup:folder.backupsTitle")} description={t("setup:folder.backupsDescription")} headingLevel={2}>
            {/* After a restore the app decides where to go: finished setup leads to Today. */}
            <BackupList backups={backupsFound} onRestored={() => void navigate({ to: "/" })} />
          </Card>
        )}
      </div>
    </SetupFrame>
  );
}
