// A progress bar a screen reader can read: role="progressbar" with the current value and the largest value.
// When the total is not known yet (`max` is null) the bar is "indeterminate": it moves, and no value is announced.
import { cn } from "@/lib/cn";

type ProgressBarProps = {
  value: number;
  max: number | null;
  label: string; // what is progressing, for example "Reading your resume"
  className?: string;
};

export function ProgressBar({ value, max, label, className }: ProgressBarProps) {
  const isKnown = max !== null && max > 0;
  const percent = isKnown ? Math.min(100, Math.round((value / max) * 100)) : 0;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={isKnown ? max : undefined}
      aria-valuenow={isKnown ? value : undefined}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-muted", className)}
    >
      {isKnown ? (
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
      ) : (
        <div className="progress-indeterminate h-full w-2/5 rounded-full bg-accent" />
      )}
    </div>
  );
}
