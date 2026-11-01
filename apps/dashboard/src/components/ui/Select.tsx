// A drop-down list. It is the browser's own <select>, which is already accessible and works with
// the keyboard and screen readers; only the look is set here.
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { controlClasses } from "./Input";

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(controlClasses, "h-9", className)} {...props} />;
}
