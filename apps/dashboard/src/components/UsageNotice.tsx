// The note shown once, before the person's first run: runs use their own Claude plan, so they share its limits.
// Spec: PRD R3 ("The app explains limits before the first run").
import { useTranslation } from "react-i18next";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";

type UsageNoticeProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue: () => void;
  isWorking: boolean;
};

export function UsageNotice({ open, onOpenChange, onContinue, isWorking }: UsageNoticeProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("common:usageNotice.title")}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t("common:actions.notNow")}</Button>
          <Button variant="accent" disabled={isWorking} onClick={onContinue}>
            {t("common:usageNotice.continue")}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p>{t("common:usageNotice.plan")}</p>
        <p>{t("common:usageNotice.limits")}</p>
        <p className="text-muted">{t("common:usageNotice.tip")}</p>
      </div>
    </Dialog>
  );
}
