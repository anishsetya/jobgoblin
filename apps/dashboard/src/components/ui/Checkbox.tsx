// A tick box with its label beside it. The label is part of the control, so clicking the words works too.
import { useId, type ComponentProps } from "react";
import { cn } from "@/lib/cn";

type CheckboxProps = Omit<ComponentProps<"input">, "type" | "id"> & {
  label: string;
  hint?: string;
};

export function Checkbox({ label, hint, className, ...props }: CheckboxProps) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className={cn("flex items-start gap-2", className)}>
      <input
        id={id}
        type="checkbox"
        aria-describedby={hint === undefined ? undefined : hintId}
        className="mt-0.5 size-4 shrink-0 accent-accent"
        {...props}
      />
      <div>
        <label htmlFor={id} className="text-sm">
          {label}
        </label>
        {hint !== undefined && (
          <p id={hintId} className="text-xs text-muted">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
