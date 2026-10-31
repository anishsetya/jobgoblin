// One line of a resume. A line the run reworded is highlighted with a tinted background and a bar on its
// left (not by color alone), and a screen reader hears "Reworded:" before it. The legend above the
// preview explains the highlight.
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

type ResumeTextProps = {
  text: string;
  isReworded: boolean;
};

export function ResumeText({ text, isReworded }: ResumeTextProps) {
  const { t } = useTranslation();
  if (!isReworded) return <>{text}</>;

  return (
    <span className={cn("rounded-sm border-l-2 border-accent bg-accent-soft px-1.5")}>
      <span className="sr-only">{t("common:resumePreview.rewordedPrefix")} </span>
      {text}
    </span>
  );
}
