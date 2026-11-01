// Joins class names and lets the last Tailwind class win ("px-2 px-4" becomes "px-4").
// Every component uses it so a caller's className can override a component's defaults.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
