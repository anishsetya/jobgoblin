// The top of an application screen: the role as the one h1, then company, place, any badges, and a button
// that opens the posting in the person's default browser. Shared by Review, Open application and the Application screen.
// The role, company and place come from the posting, so a word longer than the line is broken (wrap-anywhere)
// instead of pushing the page wider than the window.
import type { Job } from "@jobgoblin/schemas";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { openPostingLink } from "@/api/desktop";
import { Button } from "./ui/Button";

type ApplicationHeaderProps = {
  title: string;
  company: string;
  job: Job;
  // A short line above the title, such as "2 of 5 waiting for review".
  eyebrow?: string;
  badges?: ReactNode;
};

export function ApplicationHeader({ title, company, job, eyebrow, badges }: ApplicationHeaderProps) {
  const { t } = useTranslation();
  const postingUrl = job.url;

  return (
    <header className="space-y-2">
      {eyebrow !== undefined && <p className="text-sm text-muted">{eyebrow}</p>}
      <h1 className="text-2xl font-semibold wrap-anywhere">{title}</h1>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <span className="wrap-anywhere">{company}</span>
        {job.location !== "" && <span className="wrap-anywhere">{job.location}</span>}
        {badges}
        {postingUrl !== null && (
          <Button variant="ghost" size="small" onClick={() => openPostingLink(postingUrl)}>
            {t("common:actions.openPosting")}
            <ExternalLink aria-hidden="true" className="size-4" />
          </Button>
        )}
      </div>
    </header>
  );
}
