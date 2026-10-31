// Step 4: add the resume (PDF or Word) and, if the person wants, their LinkedIn PDF. The files go to the local
// app as a file upload. Contact details are removed before Claude reads anything (decision D10). Then a run reads
// the resume and drafts Your story; its progress shows here, and Continue unlocks when it is done.
// Spec: PRD P1 and R3, ARCHITECTURE.md sections 8 (D10) and 11 (POST /api/import-resume).
import type { Run } from "@jobgoblin/schemas";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useSetupRun } from "@/api/runs";
import { useImportResume } from "@/api/story";
import { ErrorNotice } from "@/components/ErrorNotice";
import { RunCard } from "@/components/RunCard";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { useUsageNotice } from "@/components/useUsageNotice";
import { formatFileSize } from "@/lib/format";
import { SetupFrame } from "../SetupFrame";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // the server's limit (ARCHITECTURE.md section 11)

function pickedFile(event: ChangeEvent<HTMLInputElement>): File | null {
  return event.target.files?.[0] ?? null;
}

export function ResumeStep() {
  const { t } = useTranslation();
  const importResume = useImportResume();
  const { runAfterNotice, usageNotice } = useUsageNotice();
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [linkedinFile, setLinkedinFile] = useState<File | null>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  const setupRun = useSetupRun(runId);
  const isRunActive = setupRun !== null && (setupRun.status === "queued" || setupRun.status === "running");
  const isRunDone = setupRun?.status === "done";

  function startReading(event: FormEvent): void {
    event.preventDefault();
    if (resumeFile === null) return;

    const tooBig = [resumeFile, linkedinFile].find((file) => file !== null && file.size > MAX_UPLOAD_BYTES);
    if (tooBig !== undefined && tooBig !== null) {
      setSizeError(t("setup:resume.tooBig", { name: tooBig.name, size: formatFileSize(MAX_UPLOAD_BYTES) }));
      return;
    }
    setSizeError(null);
    runAfterNotice(() => void uploadFiles(resumeFile));
  }

  // The LinkedIn file goes first: the reading run starts as soon as the resume arrives and should see both.
  async function uploadFiles(resume: File): Promise<void> {
    try {
      if (linkedinFile !== null) await importResume.mutateAsync({ file: linkedinFile, kind: "linkedin" });
      const result = await importResume.mutateAsync({ file: resume, kind: "resume" });
      setRunId(result.runId);
    } catch {
      // The error is shown from importResume.error below; nothing else to do here.
    }
  }

  return (
    <SetupFrame step={4} title={t("setup:resume.title")} description={t("setup:resume.description")} canContinue={isRunDone}>
      <div className="space-y-6">
        {!isRunActive && !isRunDone && (
          <form onSubmit={startReading} className="space-y-4">
            <Field label={t("setup:resume.resumeLabel")} hint={t("setup:resume.resumeHint")}>
              {(control) => (
                <Input {...control} type="file" accept=".pdf,.doc,.docx" onChange={(event) => setResumeFile(pickedFile(event))} />
              )}
            </Field>
            <Field label={t("setup:resume.linkedinLabel")} hint={t("setup:resume.linkedinHint")}>
              {(control) => <Input {...control} type="file" accept=".pdf" onChange={(event) => setLinkedinFile(pickedFile(event))} />}
            </Field>
            <p className="text-xs text-muted">{t("setup:resume.privacy")}</p>
            {sizeError !== null && <p className="text-sm text-danger">{sizeError}</p>}
            <Button type="submit" disabled={resumeFile === null || importResume.isPending}>
              {importResume.isPending ? t("setup:resume.uploading") : t("setup:resume.read")}
            </Button>
            <ErrorNotice error={importResume.error} />
          </form>
        )}

        {setupRun !== null && (
          <RunCard run={setupRun} headingLevel={2} onRetried={(newRun: Run) => setRunId(newRun.id)} />
        )}

        {isRunDone && <p role="status" className="text-sm text-success">{t("setup:resume.done")}</p>}
      </div>
      {usageNotice}
    </SetupFrame>
  );
}
