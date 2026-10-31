// Settings > Backups: when the last backup was made, "Back up now", and the list of backups with Restore.
// Backups happen by themselves after changes and every day; this is for the person's peace of mind.
// Spec: PRD S5 ("Settings shows the last backup time"; "one-click Restore").
import type { SettingsResponse } from "@jobgoblin/schemas";
import { useTranslation } from "react-i18next";
import { useBackUpNow, useBackups } from "@/api/backups";
import { BackupList } from "@/components/BackupList";
import { ErrorNotice } from "@/components/ErrorNotice";
import { LoadingNote } from "@/components/LoadingNote";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatMoment } from "@/lib/format";

export function BackupsSection({ settings }: { settings: SettingsResponse }) {
  const { t } = useTranslation();
  const backups = useBackups();
  const backUpNow = useBackUpNow();

  function renderBackups() {
    if (backups.isPending) return <LoadingNote />;
    if (backups.isError) return <ErrorNotice error={backups.error} onRetry={() => void backups.refetch()} />;
    if (backups.data.length === 0) return <p className="text-sm text-muted">{t("settings:backups.none")}</p>;
    return <BackupList backups={backups.data} />;
  }

  return (
    <Card
      title={t("settings:backups.title")}
      description={t("settings:backups.description")}
      actions={
        <Button disabled={backUpNow.isPending || settings.personFolder === null} onClick={() => backUpNow.mutate()}>
          {backUpNow.isPending ? t("settings:backups.backingUp") : t("settings:backups.backUpNow")}
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm">
          {settings.lastBackupAt === null
            ? t("settings:backups.never")
            : t("settings:backups.last", { when: formatMoment(settings.lastBackupAt) })}
        </p>
        <ErrorNotice error={backUpNow.error} />
        {renderBackups()}
      </div>
    </Card>
  );
}
