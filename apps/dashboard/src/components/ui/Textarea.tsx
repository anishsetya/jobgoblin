// A multi-line text box. Always give it a label (use Field, or aria-label when the label is elsewhere).
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { controlClasses } from "./Input";

export function Textarea({ className, rows = 4, ...props }: ComponentProps<"textarea">) {
  return <textarea rows={rows} className={cn(controlClasses, "py-2", className)} {...props} />;
}
