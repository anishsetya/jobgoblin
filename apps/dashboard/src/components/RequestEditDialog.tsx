// Asks the person what should change in a tailored resume, then sends it with "Request edit".
// The note goes to the next tailoring run as an instruction. Spec: PRD A2.
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ErrorNotice } from "./ErrorNotice";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { Field } from "./ui/Field";
import { Textarea } from "./ui/Textarea";

type RequestEditDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (note: string) => void;
  isSending: boolean;
  error: unknown;
};

export function RequestEditDialog({ open, onOpenChange, onSend, isSending, error }: RequestEditDialogProps) {
  const { t } = useTranslation();
  const [note, setNote] = useState("");
  const trimmedNote = note.trim();

  function send(event: FormEvent): void {
    event.preventDefault();
    if (trimmedNote !== "") onSend(trimmedNote);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("review:requestEdit.title")}
      description={t("review:requestEdit.description")}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t("common:actions.cancel")}</Button>
          <Button type="submit" form="request-edit" disabled={trimmedNote === "" || isSending}>
            {isSending ? t("review:requestEdit.sending") : t("review:requestEdit.send")}
          </Button>
        </>
      }
    >
      <form id="request-edit" onSubmit={send} className="space-y-4">
        <Field label={t("review:requestEdit.noteLabel")} hint={t("review:requestEdit.noteHint")}>
          {(control) => <Textarea {...control} rows={4} value={note} onChange={(event) => setNote(event.target.value)} />}
        </Field>
        <ErrorNotice error={error} />
      </form>
    </Dialog>
  );
}
