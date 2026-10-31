// A list of backups, each with a Restore button. Restoring replaces the person's current data, so it
// asks first. Used in Settings and in the setup wizard (when backups are found in the chosen folder).
// Spec: PRD S5 ("one-click Restore"), ARCHITECTURE.md section 7 (restore saves the current data first).
import type { Backup } from "@jobgoblin/schemas";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRestoreBackup } from "@/api/backups";
import { formatFileSize, formatMoment } from "@/lib/format";
import { ErrorNotice } from "./ErrorNotice";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";

type BackupListProps = {
  backups: Backup[];
  onRestored?: () => void;
};

export function BackupList({ backups, onRestored }: BackupListProps) {
  const { t } = useTranslation();
  const restoreBackup = useRestoreBackup();
  const [backupToRestore, setBackupToRestore] = useState<Backup | null>(null);

  function confirmRestore(): void {
    if (backupToRestore === null) return;
    restoreBackup.mutate(backupToRestore.id, {
      onSuccess: () => {
        setBackupToRestore(null);
        onRestored?.();
      },
    });
  }

  function closeDialog(): void {
    setBackupToRestore(null);
    restoreBackup.reset();
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line rounded-md border border-line">
        {backups.map((backup) => {
          const when = formatMoment(backup.createdAt);
          return (
            <li key={backup.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div>
                <p className="text-sm">{when}</p>
                <p className="text-xs text-muted">{formatFileSize(backup.sizeBytes)}</p>
              </div>
              <Button size="small" aria-label={t("common:backups.restoreLabel", { when })} onClick={() => setBackupToRestore(backup)}>
                {t("common:backups.restore")}
              </Button>
            </li>
          );
        })}
      </ul>

      {backupToRestore !== null && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
          title={t("common:backups.confirmTitle")}
          description={t("common:backups.confirmDescription", { when: formatMoment(backupToRestore.createdAt) })}
          footer={
            <>
              <Button onClick={closeDialog}>{t("common:actions.cancel")}</Button>
              <Button variant="danger-quiet" disabled={restoreBackup.isPending} onClick={confirmRestore}>
                {restoreBackup.isPending ? t("common:backups.restoring") : t("common:backups.restore")}
              </Button>
            </>
          }
        >
          <ErrorNotice error={restoreBackup.error} />
        </Dialog>
      )}
    </div>
  );
}
