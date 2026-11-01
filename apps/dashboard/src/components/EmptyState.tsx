// What a list or screen shows when there is nothing in it yet. It says what the space is for and
// invites exactly one action (PRD: "Empty states invite one action").
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  headingLevel?: 2 | 3;
  className?: string;
};

export function EmptyState({ title, description, action, headingLevel = 2, className }: EmptyStateProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className={cn("rounded-lg border border-dashed border-line px-6 py-10 text-center", className)}>
      <Heading className="text-base font-semibold">{title}</Heading>
      {description !== undefined && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{description}</p>}
      {action !== undefined && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
