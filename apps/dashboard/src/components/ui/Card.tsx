// A bordered panel with an optional heading, description and action buttons in its header.
// With a title it is a labelled region (section) so screen reader users can jump between panels.
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type CardProps = {
  title?: string;
  // The heading level, so each screen keeps a sensible outline (one h1, panels at h2, parts of a panel at h3).
  headingLevel?: 2 | 3;
  description?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function Card({ title, headingLevel = 2, description, actions, className, children }: CardProps) {
  const headingId = useId();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const classes = cn("rounded-lg border border-line bg-surface p-5", className);

  if (title === undefined) return <div className={classes}>{children}</div>;

  return (
    <section aria-labelledby={headingId} className={classes}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Heading id={headingId} className="text-base font-semibold">
            {title}
          </Heading>
          {description !== undefined && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
        {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
