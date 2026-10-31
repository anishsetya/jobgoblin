// "I submitted": the person says the application was sent and gives proof. The application becomes Applied
// only with proof recorded (PRD U4). Optionally the person picks the resume file they attached; its fingerprint
// is compared with the approved file, so a different file cannot be recorded by accident (PRD T2).
// The file is read in the browser and never uploaded; only its fingerprint is sent.
import { ProofType, type Approval, type SubmittedRequest } from "@jobgoblin/schemas";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMarkSubmitted } from "@/api/applications";
import { sha256HexOfFile } from "@/lib/hash";
import { ErrorNotice } from "./ErrorNotice";
import { Button } from "./ui/Button";
import { Checkbox } from "./ui/Checkbox";
import { Dialog } from "./ui/Dialog";
import { Field } from "./ui/Field";
import { Input } from "./ui/Input";
import { RadioGroup } from "./ui/RadioGroup";
import { Textarea } from "./ui/Textarea";

type SubmittedDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  approval: Approval;
  onSubmitted: () => void;
};

const DEFAULT_PROOF_TYPE: ProofType = "confirmation-page";

export function SubmittedDialog({ open, onOpenChange, approval, onSubmitted }: SubmittedDialogProps) {
  const { t } = useTranslation();
  const markSubmitted = useMarkSubmitted(approval.applicationId);
  const [proofType, setProofType] = useState<ProofType>(DEFAULT_PROOF_TYPE);
  const [proof, setProof] = useState("");
  const [attachedSha256, setAttachedSha256] = useState<string | null>(null);
  const [acceptsDifferentFile, setAcceptsDifferentFile] = useState(false);

  const needsProofText = proofType !== "person-saw-it";
  const isDifferentFile = attachedSha256 !== null && attachedSha256 !== approval.pdfSha256;
  const canSend = (!needsProofText || proof.trim() !== "") && (!isDifferentFile || acceptsDifferentFile);

  const proofOptions = ProofType.options.map((value) => ({
    value,
    label: t(`apply:submitted.proofType.${value}.label`),
    hint: t(`apply:submitted.proofType.${value}.hint`),
  }));

  async function readAttachedFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    setAcceptsDifferentFile(false);
    setAttachedSha256(file === undefined ? null : await sha256HexOfFile(file));
  }

  function send(event: FormEvent): void {
    event.preventDefault();
    if (!canSend) return;
    const request: SubmittedRequest = {
      proofType,
      proof: needsProofText ? proof.trim() : t("apply:submitted.personSawItProof"),
      attachedSha256,
      confirmDifferentFile: isDifferentFile ? true : undefined,
    };
    markSubmitted.mutate(request, { onSuccess: onSubmitted });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("apply:submitted.title")}
      description={t("apply:submitted.description")}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t("common:actions.cancel")}</Button>
          <Button type="submit" form="submitted" variant="accent" disabled={!canSend || markSubmitted.isPending}>
            {markSubmitted.isPending ? t("apply:submitted.saving") : t("apply:submitted.save")}
          </Button>
        </>
      }
    >
      <form id="submitted" onSubmit={send} className="space-y-5">
        <RadioGroup
          legend={t("apply:submitted.proofLegend")}
          options={proofOptions}
          value={proofType}
          onChange={(value) => setProofType(ProofType.parse(value))}
        />

        {needsProofText && (
          <Field label={t(`apply:submitted.proofType.${proofType}.field`)}>
            {(control) => <Textarea {...control} rows={3} value={proof} onChange={(event) => setProof(event.target.value)} />}
          </Field>
        )}

        <Field label={t("apply:submitted.fileLabel")} hint={t("apply:submitted.fileHint")}>
          {(control) => <Input {...control} type="file" accept=".pdf" onChange={(event) => void readAttachedFile(event)} />}
        </Field>

        {isDifferentFile && (
          <div className="space-y-2 rounded-md border border-flag-line bg-flag-soft p-3 text-sm text-flag">
            <p>{t("apply:submitted.differentFile")}</p>
            <Checkbox
              label={t("apply:submitted.recordAnyway")}
              checked={acceptsDifferentFile}
              onChange={(event) => setAcceptsDifferentFile(event.target.checked)}
            />
          </div>
        )}

        <ErrorNotice error={markSubmitted.error} />
      </form>
    </Dialog>
  );
}
