// "Add a job": paste a link, or paste the job's text with its company and title. For a site that needs a
// login (LinkedIn, say) the server cannot read the link, so it answers needsText and this dialog asks for the text
// straight away. Spec: PRD D2, ARCHITECTURE.md section 5.9 (AddJobRequest).
import { AddJobRequest } from "@jobgoblin/schemas";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAddJob } from "@/api/today";
import { ErrorNotice } from "./ErrorNotice";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { Field } from "./ui/Field";
import { Input } from "./ui/Input";
import { Textarea } from "./ui/Textarea";

type AddJobDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Called with the server's own sentence ("Added. Claude is reading it now.") when a job was accepted.
  onAdded: (message: string) => void;
};

type Draft = { url: string; text: string; company: string; title: string; location: string };
const EMPTY_DRAFT: Draft = { url: "", text: "", company: "", title: "", location: "" };

// Empty boxes count as not given.
function blankToUndefined(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function AddJobDialog({ open, onOpenChange, onAdded }: AddJobDialogProps) {
  const { t } = useTranslation();
  const addJob = useAddJob();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [showsText, setShowsText] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  const [needsTextMessage, setNeedsTextMessage] = useState<string | null>(null);

  function setField(field: keyof Draft, value: string): void {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function close(): void {
    onOpenChange(false);
    setDraft(EMPTY_DRAFT);
    setShowsText(false);
    setFieldErrors({});
    setNeedsTextMessage(null);
    addJob.reset();
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    const parsed = AddJobRequest.safeParse({
      url: blankToUndefined(draft.url),
      text: blankToUndefined(draft.text),
      company: blankToUndefined(draft.company),
      title: blankToUndefined(draft.title),
      location: blankToUndefined(draft.location),
    });

    if (!parsed.success) {
      // Each problem names its own box; a problem with no box ("add a link or paste the text") goes under "form".
      const errors: Partial<Record<string, string>> = {};
      for (const issue of parsed.error.issues) {
        errors[issue.path.length === 0 ? "form" : String(issue.path[0])] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    addJob.mutate(parsed.data, {
      onSuccess: (response) => {
        if (response.needsText) {
          setNeedsTextMessage(response.message);
          setShowsText(true);
          return;
        }
        onAdded(response.message);
        close();
      },
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => (isOpen ? onOpenChange(true) : close())}
      title={t("today:addJob.title")}
      description={t("today:addJob.description")}
      footer={
        <>
          <Button onClick={close}>{t("common:actions.cancel")}</Button>
          <Button type="submit" form="add-job" variant="accent" disabled={addJob.isPending}>
            {addJob.isPending ? t("today:addJob.adding") : t("today:addJob.submit")}
          </Button>
        </>
      }
    >
      <form id="add-job" onSubmit={submit} className="space-y-4">
        {needsTextMessage !== null && (
          <p role="status" className="rounded-md border border-flag-line bg-flag-soft p-3 text-sm text-flag">
            {needsTextMessage}
          </p>
        )}
        {fieldErrors.form !== undefined && <p className="text-sm text-danger">{fieldErrors.form}</p>}

        <Field label={t("today:addJob.link")} error={fieldErrors.url}>
          {(control) => <Input {...control} type="url" value={draft.url} onChange={(event) => setField("url", event.target.value)} />}
        </Field>

        {!showsText && (
          <Button variant="ghost" size="small" onClick={() => setShowsText(true)}>
            {t("today:addJob.pasteInstead")}
          </Button>
        )}

        {showsText && (
          <>
            <Field label={t("today:addJob.company")} error={fieldErrors.company}>
              {(control) => <Input {...control} value={draft.company} onChange={(event) => setField("company", event.target.value)} />}
            </Field>
            <Field label={t("today:addJob.jobTitle")} error={fieldErrors.title}>
              {(control) => <Input {...control} value={draft.title} onChange={(event) => setField("title", event.target.value)} />}
            </Field>
            <Field label={t("today:addJob.location")} hint={t("today:addJob.optional")}>
              {(control) => <Input {...control} value={draft.location} onChange={(event) => setField("location", event.target.value)} />}
            </Field>
            <Field label={t("today:addJob.text")} error={fieldErrors.text}>
              {(control) => <Textarea {...control} rows={6} value={draft.text} onChange={(event) => setField("text", event.target.value)} />}
            </Field>
          </>
        )}

        <ErrorNotice error={addJob.error} />
      </form>
    </Dialog>
  );
}
