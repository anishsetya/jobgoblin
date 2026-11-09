// A box for one file: drop it here or choose it from the computer. Once a file is chosen the box shows its name and
// size, with Change and Remove. Put it inside a Field, which supplies the visible label:
//   <Field label="Your resume">{(control) => <FileDropZone {...control} file={file} onFileChange={setFile} accept=".pdf" />}</Field>
// The real <input type="file"> is hidden from the eye but not from the keyboard or a screen reader, so the label
// names it, Tab reaches it, and Enter or Space opens the computer's file chooser.
// Spec: PRD "Accessibility" (every control has a name and works from the keyboard).
import { FileText, Upload } from "lucide-react";
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import type { FieldControlProps } from "@/components/ui/Field";
import { cn } from "@/lib/cn";
import { formatFileSize } from "@/lib/format";

type FileDropZoneProps = FieldControlProps & {
  file: File | null;
  onFileChange: (file: File | null) => void;
  // The kinds of file the computer's chooser offers, such as ".pdf,.docx". A dropped file is not filtered here:
  // the server checks every file and says in plain words when it cannot read one.
  accept: string;
  disabled?: boolean;
};

export function FileDropZone({ file, onFileChange, accept, disabled = false, ...controlProps }: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  function openChooser(): void {
    if (!disabled) inputRef.current?.click();
  }

  function handleChosen(event: ChangeEvent<HTMLInputElement>): void {
    const chosen = event.target.files?.[0] ?? null;
    // Cleared so that choosing the same file again, after Remove, still counts as a change.
    event.target.value = "";
    if (chosen !== null) onFileChange(chosen);
  }

  function handleDragOver(event: DragEvent): void {
    if (disabled) return;
    event.preventDefault(); // without this the browser would open the dropped file instead
    setIsDraggingOver(true);
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    setIsDraggingOver(false);
    const dropped = event.dataTransfer.files[0];
    if (!disabled && dropped !== undefined) onFileChange(dropped);
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDrop}
      className={cn(
        // The hidden input is the one that gets the keyboard focus, so the focus ring is drawn round the whole box.
        "rounded-lg border bg-surface transition-colors has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:[outline:2px_solid_var(--focus)]",
        // A dashed, slightly stronger edge says "drop here"; a chosen file is a plain card.
        file === null ? "border-dashed border-muted/50" : "border-solid",
        isDraggingOver && "border-accent bg-accent-soft",
      )}
    >
      <input
        {...controlProps}
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={handleChosen}
        className="sr-only"
      />

      {file === null ? (
        <EmptyZone isDisabled={disabled} onClick={openChooser} />
      ) : (
        <ChosenFile file={file} isDisabled={disabled} onChange={openChooser} onRemove={() => onFileChange(null)} />
      )}
    </div>
  );
}

function EmptyZone({ isDisabled, onClick }: { isDisabled: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      onClick={onClick}
      className={cn("flex flex-col items-center gap-1 px-4 py-8 text-center", !isDisabled && "cursor-pointer")}
    >
      <Upload aria-hidden="true" className="size-5 text-muted" />
      <p className="text-sm">
        {t("common:fileDrop.prompt")}{" "}
        <span className="font-medium text-accent-text underline underline-offset-2">{t("common:fileDrop.choose")}</span>
      </p>
    </div>
  );
}

type ChosenFileProps = { file: File; isDisabled: boolean; onChange: () => void; onRemove: () => void };

function ChosenFile({ file, isDisabled, onChange, onRemove }: ChosenFileProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <FileText aria-hidden="true" className="size-5 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.name}</p>
        <p className="text-xs text-muted">{formatFileSize(file.size)}</p>
      </div>
      {/* While the file is being read the card is just a record of what was chosen: nothing to change. */}
      {!isDisabled && (
        <div className="flex gap-2">
          <Button size="small" aria-label={t("common:fileDrop.changeLabel", { name: file.name })} onClick={onChange}>
            {t("common:fileDrop.change")}
          </Button>
          <Button size="small" variant="ghost" aria-label={t("common:fileDrop.removeLabel", { name: file.name })} onClick={onRemove}>
            {t("common:fileDrop.remove")}
          </Button>
        </div>
      )}
    </div>
  );
}
