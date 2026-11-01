// The text of a job posting, shown as plain text.
// SAFETY: a posting is written by strangers on the internet and may contain HTML or scripts meant to
// run in this page. It is therefore only ever rendered as text (React escapes it), never as HTML:
// no dangerouslySetInnerHTML anywhere in this app. Line breaks are kept with CSS.
import { useTranslation } from "react-i18next";

export function JobText({ text }: { text: string }) {
  const { t } = useTranslation();
  // A scrollable box must be reachable by keyboard, so it can take focus and has a name.
  return (
    <div
      role="region"
      aria-label={t("common:jobText.label")}
      tabIndex={0}
      className="max-h-96 overflow-y-auto rounded-md border border-line bg-page p-4 text-sm leading-relaxed whitespace-pre-wrap"
    >
      {text}
    </div>
  );
}
