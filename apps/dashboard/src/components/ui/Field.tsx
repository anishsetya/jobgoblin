// A form field: a visible label, an optional hint, the control, and an error or warning message, all tied
// together so a screen reader reads "Label, hint, error" when the control is focused.
// The control is passed as a function so the field can hand it the ids it needs:
//   <Field label="Email">{(control) => <Input {...control} />}</Field>
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type FieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
};

type FieldProps = {
  label: string;
  hint?: string;
  // Why the value was not accepted. The control is marked invalid.
  error?: string;
  // Something to check about a value that was accepted, such as an email address with no "@". It stops
  // nothing, so the control is not marked invalid.
  warning?: string;
  // Extra content next to the label, such as a "Needs your answer" badge.
  badge?: ReactNode;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
};

export function Field({ label, hint, error, warning, badge, className, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const warningId = `${id}-warning`;

  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId, warning === undefined ? null : warningId]
    .filter((part) => part !== null)
    .join(" ");

  const control: FieldControlProps = {
    id,
    "aria-describedby": describedBy === "" ? undefined : describedBy,
    "aria-invalid": error === undefined ? undefined : true,
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {badge}
      </div>
      {hint !== undefined && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {children(control)}
      {error !== undefined && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
      {warning !== undefined && (
        <p id={warningId} className="text-sm text-flag">
          {warning}
        </p>
      )}
    </div>
  );
}
