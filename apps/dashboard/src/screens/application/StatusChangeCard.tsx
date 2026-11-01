// Moves an application along (Phone screen, Onsite, Offer, Rejected, ...) and sets when to follow up.
// Only the moves in `allowedStatusMoves` are offered. Applied and Approved are never among them: those come
// only from "I submitted" and Approve (decision D16). Spec: PRD K2.
import type { ApplicationStatus } from "@jobgoblin/schemas";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useChangeStatus } from "@/api/applications";
import { ErrorNotice } from "@/components/ErrorNotice";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

type StatusChangeCardProps = {
  applicationId: string;
  allowedMoves: ApplicationStatus[];
};

export function StatusChangeCard({ applicationId, allowedMoves }: StatusChangeCardProps) {
  const { t } = useTranslation();
  const changeStatus = useChangeStatus(applicationId);
  const [newStatus, setNewStatus] = useState("");
  const [followUpOn, setFollowUpOn] = useState("");
  const [note, setNote] = useState("");

  if (allowedMoves.length === 0) return null;

  function submit(event: FormEvent): void {
    event.preventDefault();
    const chosenStatus = allowedMoves.find((status) => status === newStatus);
    if (chosenStatus === undefined) return;
    changeStatus.mutate(
      {
        to: chosenStatus,
        // An empty date box means "leave the follow-up day as it is".
        followUpOn: followUpOn === "" ? undefined : followUpOn,
        note: note.trim() === "" ? undefined : note.trim(),
      },
      {
        onSuccess: () => {
          setNewStatus("");
          setFollowUpOn("");
          setNote("");
        },
      },
    );
  }

  return (
    <Card title={t("application:status.title")} description={t("application:status.description")}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("application:status.newStatus")}>
            {(control) => (
              <Select {...control} value={newStatus} onChange={(event) => setNewStatus(event.target.value)}>
                <option value="">{t("application:status.choose")}</option>
                {allowedMoves.map((status) => (
                  <option key={status} value={status}>
                    {t(`common:status.${status}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("application:status.followUp")} hint={t("application:status.followUpHint")}>
            {(control) => <Input {...control} type="date" value={followUpOn} onChange={(event) => setFollowUpOn(event.target.value)} />}
          </Field>
        </div>
        <Field label={t("application:status.note")}>
          {(control) => <Input {...control} value={note} onChange={(event) => setNote(event.target.value)} />}
        </Field>
        <Button type="submit" disabled={newStatus === "" || changeStatus.isPending}>
          {changeStatus.isPending ? t("common:actions.saving") : t("application:status.change")}
        </Button>
        <ErrorNotice error={changeStatus.error} />
      </form>
    </Card>
  );
}
