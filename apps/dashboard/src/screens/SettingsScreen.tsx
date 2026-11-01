// Settings: the connection to Claude, the person's folder, limits, the tracker files, and backups.
// Spec: PRD "Screens: Settings" and S3-S5, T4, K3, ARCHITECTURE.md section 12 (/settings).
import { useTranslation } from "react-i18next";
import { useSettings } from "@/api/settings";
import { ClaudeConnection } from "@/components/ClaudeConnection";
import { ErrorNotice } from "@/components/ErrorNotice";
import { LoadingNote } from "@/components/LoadingNote";
import { Card } from "@/components/ui/Card";
import { usePageTitle } from "@/lib/pageTitle";
import { BackupsSection } from "./settings/BackupsSection";
import { FolderSection } from "./settings/FolderSection";
import { LimitsSection } from "./settings/LimitsSection";
import { TrackerSection } from "./settings/TrackerSection";

export function SettingsScreen() {
  const { t } = useTranslation();
  usePageTitle(t("settings:title"));
  const settings = useSettings();

  if (settings.isPending) return <LoadingNote />;
  if (settings.isError) return <ErrorNotice error={settings.error} onRetry={() => void settings.refetch()} />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("settings:title")}</h1>

      <Card title={t("settings:claude.title")} description={t("settings:claude.description")}>
        <ClaudeConnection />
      </Card>
      <FolderSection settings={settings.data} />
      <LimitsSection settings={settings.data} />
      <TrackerSection settings={settings.data} />
      <BackupsSection settings={settings.data} />
    </div>
  );
}
