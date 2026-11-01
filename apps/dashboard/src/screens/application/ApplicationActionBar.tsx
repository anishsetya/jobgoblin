// The buttons at the top of the Application screen. Which ones show comes from `detail.actions`, which the
// server works out with the rules in packages/core; the dashboard never decides for itself what is allowed.
import type { ApplicationDetail } from "@jobgoblin/schemas";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useTailorApplication, useUndoSkipApplication, useWithdrawApplication } from "@/api/applications";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Textarea } from "@/components/ui/Textarea";

export function ApplicationActionBar({ detail }: { detail: ApplicationDetail }) {
  const { t } = useTranslation();
  const { application, approval, actions } = detail;
  const tailor = useTailorApplication(application.id);
  const undoSkip = useUndoSkipApplication(application.id);
  const withdraw = useWithdrawApplication(application.id);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [withdrawNote, setWithdrawNote] = useState("");

  const hasLiveApproval = approval !== null && approval.voidedAt === null && approval.usedAt === null;
  const hasAnyAction =
    actions.canApprove || actions.canTailor || actions.canUndoSkip || actions.canWithdraw || hasLiveApproval;
  if (!hasAnyAction) return null;

  function closeWithdraw(): void {
    setIsWithdrawOpen(false);
    withdraw.reset();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {actions.canApprove && (
          <Button asChild variant="accent">
            <Link to="/review/$id" params={{ id: application.id }}>
              {t("application:actions.review")}
            </Link>
          </Button>
        )}
        {hasLiveApproval && (
          <Button asChild variant={actions.canApprove ? "secondary" : "accent"}>
            <Link to="/apply/$id" params={{ id: application.id }}>
              {t("application:actions.openApplication")}
            </Link>
          </Button>
        )}
        {actions.canTailor && (
          <Button disabled={tailor.isPending} onClick={() => tailor.mutate()}>
            {tailor.isPending ? t("application:actions.tailoring") : t("application:actions.tailor")}
          </Button>
        )}
        {actions.canUndoSkip && (
          <Button disabled={undoSkip.isPending} onClick={() => undoSkip.mutate()}>
            {t("application:actions.undoSkip")}
          </Button>
        )}
        {actions.canWithdraw && (
          <Button variant="danger-quiet" onClick={() => setIsWithdrawOpen(true)}>
            {t("application:actions.withdraw")}
          </Button>
        )}
      </div>
      <ErrorNotice error={tailor.error ?? undoSkip.error} />

      <Dialog
        open={isWithdrawOpen}
        onOpenChange={(open) => (open ? setIsWithdrawOpen(true) : closeWithdraw())}
        title={t("application:withdraw.title")}
        description={t("application:withdraw.description")}
        footer={
          <>
            <Button onClick={closeWithdraw}>{t("common:actions.cancel")}</Button>
            <Button
              variant="danger-quiet"
              disabled={withdraw.isPending}
              onClick={() => withdraw.mutate(withdrawNote.trim(), { onSuccess: closeWithdraw })}
            >
              {t("application:withdraw.confirm")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t("application:withdraw.noteLabel")} hint={t("application:withdraw.noteHint")}>
            {(control) => <Textarea {...control} rows={3} value={withdrawNote} onChange={(event) => setWithdrawNote(event.target.value)} />}
          </Field>
          <ErrorNotice error={withdraw.error} />
        </div>
      </Dialog>
    </div>
  );
}
