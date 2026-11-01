// A one-line text box. Always give it a label (use Field, or aria-label when the label is elsewhere).
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export const controlClasses =
  "w-full rounded-md border border-line bg-surface px-3 text-sm text-text placeholder:text-muted " +
  "disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger";

export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return <input type={type} className={cn(controlClasses, "h-9", className)} {...props} />;
}
