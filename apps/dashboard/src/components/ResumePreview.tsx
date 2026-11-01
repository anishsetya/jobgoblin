// An on-screen version of the tailored resume, built from the resume's data (ResumeBody + ResumeHeader)
// and the Your story items it cites. It exists because a PDF cannot highlight what changed and an
// <iframe> cannot send the session token (decision D12). The real PDF is opened with "Open PDF".
// SAFETY: every piece of text here is rendered as text by React, never as HTML (no dangerouslySetInnerHTML),
// so nothing in a resume or a story item can run as code in this page.
import type { ResumeBody, ResumeDiff, ResumeHeader, StoryItem } from "@jobgoblin/schemas";
import { useTranslation } from "react-i18next";
import { formatStoryDateRange } from "@/lib/format";
import { ResumeEntries } from "./ResumeEntries";
import { ResumeText } from "./ResumeText";

type ResumePreviewProps = {
  header: ResumeHeader | null;
  body: ResumeBody;
  storyItems: StoryItem[];
  diff: ResumeDiff | null;
};

function SectionTitle({ children }: { children: string }) {
  return <h3 className="mt-5 mb-2 border-b border-line pb-0.5 text-xs font-semibold tracking-wide uppercase">{children}</h3>;
}

export function ResumePreview({ header, body, storyItems, diff }: ResumePreviewProps) {
  const { t } = useTranslation();
  const itemsById = new Map(storyItems.map((item) => [item.id, item]));
  const rewordedSources = new Set(diff?.reworded.map((line) => line.src) ?? []);

  const hasProjects = body.sections.projects.length > 0;
  const educationItems = body.education.map((entry) => itemsById.get(entry.src)).filter((item) => item !== undefined);

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        <span className="mr-1 rounded-sm border-l-2 border-accent bg-accent-soft px-1.5 text-text">
          {t("common:resumePreview.legendSample")}
        </span>
        {t("common:resumePreview.legend")}
      </p>

      <article aria-label={t("common:resumePreview.label")} className="rounded-lg border border-line bg-surface p-6 text-sm leading-relaxed">
        {header !== null && (
          <header className="text-center">
            <p className="text-lg font-semibold">{header.fullName}</p>
            <p className="text-muted">{[header.email, header.phone, header.location, ...header.links].join("  |  ")}</p>
          </header>
        )}

        {body.headline !== null && (
          <p className="mt-4">
            <ResumeText text={body.headline.text} isReworded={rewordedSources.has(body.headline.src)} />
          </p>
        )}

        <SectionTitle>{t("common:resumePreview.experience")}</SectionTitle>
        <ResumeEntries entries={body.sections.experience} itemsById={itemsById} rewordedSources={rewordedSources} />

        {hasProjects && (
          <>
            <SectionTitle>{t("common:resumePreview.projects")}</SectionTitle>
            <ResumeEntries entries={body.sections.projects} itemsById={itemsById} rewordedSources={rewordedSources} />
          </>
        )}

        {body.skills.length > 0 && (
          <>
            <SectionTitle>{t("common:resumePreview.skills")}</SectionTitle>
            <p>{body.skills.map((skill) => skill.text).join(", ")}</p>
          </>
        )}

        {educationItems.length > 0 && (
          <>
            <SectionTitle>{t("common:resumePreview.education")}</SectionTitle>
            <ul className="space-y-1">
              {educationItems.map((item) => (
                <li key={item.id} className="flex flex-wrap justify-between gap-x-4">
                  <span>{[item.data.title, item.data.organization].filter(Boolean).join(", ") || item.data.text}</span>
                  <span className="text-muted">{formatStoryDateRange(item.data.startDate, item.data.endDate)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </article>
    </div>
  );
}
