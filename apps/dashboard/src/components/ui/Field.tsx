// A form field: a visible label, an optional hint, the control, and an error message, all tied together
// so a screen reader reads "Label, hint, error" when the control is focused.
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
  error?: string;
  // Extra content next to the label, such as a "Needs your answer" badge.
  badge?: ReactNode;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
};

export function Field({ label, hint, error, badge, className, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
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
    </div>
  );
}
