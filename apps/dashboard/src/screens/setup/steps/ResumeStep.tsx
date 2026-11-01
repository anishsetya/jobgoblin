// Step 4: add the resume (PDF or Word) and, if the person wants, their LinkedIn PDF. The files go to the local
// app as a file upload. Contact details are removed before Claude reads anything (decision D10). Then a run reads
// the resume and drafts Your story; its progress shows here, and Continue unlocks when it is done.
// The screen has one main action, "Read my resume", right under the resume box. If a file cannot be read, the
// reason is shown next to the file it is about, and choosing another file clears it.
// Spec: PRD P1 and R3, ARCHITECTURE.md sections 8 (D10), 11 (POST /api/import-resume) and 12.
import type { ImportResumeResponse, Run, UploadKind } from "@jobgoblin/schemas";
import { CircleCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetupRun } from "@/api/runs";
import { useImportResume } from "@/api/story";
import { ErrorNotice } from "@/components/ErrorNotice";
import { FileDropZone } from "@/components/FileDropZone";
import { RunCard } from "@/components/RunCard";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { useUsageNotice } from "@/components/useUsageNotice";
import { formatFileSize } from "@/lib/format";
import { SetupFrame } from "../SetupFrame";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // the server's limit (ARCHITECTURE.md section 11)

// A file the server refused, kept with the kind of file it was so the message appears next to that file.
type UploadProblem = { kind: UploadKind; error: unknown };

export function ResumeStep() {
  const { t } = useTranslation();
  const importResume = useImportResume();
  const { runAfterNotice, usageNotice } = useUsageNotice();
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [linkedinFile, setLinkedinFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<UploadProblem | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  const setupRun = useSetupRun(runId);
  const isRunDone = setupRun?.status === "done";
  // Between "the server started a run" and "the run arrived on this screen" the run counts as active too.
  const isRunActive = setupRun === null ? runId !== null : setupRun.status === "queued" || setupRun.status === "running";
  const isSending = importResume.isPending;
  const isLocked = isSending || isRunActive || isRunDone; // nothing can be changed while Jobgoblin is busy with the files

  // Once the files are being read, an empty box has nothing left to offer, so it is not shown. (Coming back to this
  // step after a finished read shows only the success line.)
  const showResumeBox = resumeFile !== null || !isLocked;
  const showLinkedinBox = linkedinFile !== null || !isLocked;

  const resumeSizeError = sizeErrorFor(resumeFile, t);
  const linkedinSizeError = sizeErrorFor(linkedinFile, t);
  const canRead = resumeFile !== null && resumeSizeError === undefined && linkedinSizeError === undefined && !isLocked;

  function chooseFile(kind: UploadKind, file: File | null): void {
    if (kind === "resume") setResumeFile(file);
    else setLinkedinFile(file);
    // Choosing a different file is the answer to the message, so the message goes away.
    setProblem((current) => (current?.kind === kind ? null : current));
  }

  function startReading(): void {
    if (resumeFile === null) return;
    runAfterNotice(() => void uploadFiles(resumeFile));
  }

  // The LinkedIn file goes first: the reading run starts as soon as the resume arrives and should see both.
  async function uploadFiles(resume: File): Promise<void> {
    setProblem(null);
    if (linkedinFile !== null && (await sendFile(linkedinFile, "linkedin")) === null) return;
    const result = await sendFile(resume, "resume");
    if (result !== null) setRunId(result.runId);
  }

  // Returns null when the server refused the file; the reason is kept to show next to it.
  async function sendFile(file: File, kind: UploadKind): Promise<ImportResumeResponse | null> {
    try {
      return await importResume.mutateAsync({ file, kind });
    } catch (error) {
      setProblem({ kind, error });
      return null;
    }
  }

  return (
    <SetupFrame
      step={4}
      title={t("setup:resume.title")}
      description={t("setup:resume.description")}
      canContinue={isRunDone}
      continueHint={continueHintText({ hasResume: resumeFile !== null, isReading: isSending || isRunActive }, t)}
    >
      <div className="space-y-6">
        <div className="space-y-3">
          {showResumeBox && (
            <Field label={t("setup:resume.resumeLabel")} hint={t("setup:resume.resumeHint")} error={resumeSizeError}>
              {(control) => (
                <FileDropZone
                  {...control}
                  file={resumeFile}
                  onFileChange={(file) => chooseFile("resume", file)}
                  accept=".pdf,.docx"
                  disabled={isLocked}
                />
              )}
            </Field>
          )}

          {problem?.kind === "resume" && <ErrorNotice error={problem.error} />}

          {isRunDone ? (
            <p role="status" className="flex items-center gap-2 text-sm text-success">
              <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
              {t("setup:resume.done")}
            </p>
          ) : (
            <div className="space-y-2">
              <Button variant="accent" disabled={!canRead} onClick={startReading}>
                {readButtonText({ isSending, isRunActive }, t)}
              </Button>
              <p className="text-xs text-muted">{t("setup:resume.privacy")}</p>
            </div>
          )}

          {setupRun !== null && !isRunDone && (
            <RunCard run={setupRun} headingLevel={2} onRetried={(newRun: Run) => setRunId(newRun.id)} />
          )}
        </div>

        {showLinkedinBox && (
          <div className="space-y-3">
            <Field label={t("setup:resume.linkedinLabel")} hint={t("setup:resume.linkedinHint")} error={linkedinSizeError}>
              {(control) => (
                <FileDropZone
                  {...control}
                  file={linkedinFile}
                  onFileChange={(file) => chooseFile("linkedin", file)}
                  accept=".pdf"
                  disabled={isLocked}
                />
              )}
            </Field>
            {problem?.kind === "linkedin" && <ErrorNotice error={problem.error} />}
          </div>
        )}
      </div>
      {usageNotice}
    </SetupFrame>
  );
}

type Translate = ReturnType<typeof useTranslation>["t"];

function sizeErrorFor(file: File | null, t: Translate): string | undefined {
  if (file === null || file.size <= MAX_UPLOAD_BYTES) return undefined;
  return t("setup:resume.tooBig", { name: file.name, size: formatFileSize(MAX_UPLOAD_BYTES) });
}

function readButtonText(state: { isSending: boolean; isRunActive: boolean }, t: Translate): string {
  if (state.isSending) return t("setup:resume.uploading");
  if (state.isRunActive) return t("setup:resume.reading");
  return t("setup:resume.read");
}

// Why Continue is not available yet, in one short sentence.
function continueHintText(state: { hasResume: boolean; isReading: boolean }, t: Translate): string {
  if (state.isReading) return t("setup:resume.continueHint.reading");
  if (state.hasResume) return t("setup:resume.continueHint.readFirst");
  return t("setup:resume.continueHint.addResume");
}
