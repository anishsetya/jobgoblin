// Copies text to the clipboard and says so. The "Copied" message is in a live region, so a screen
// reader announces it, and it also shows on screen for two seconds. Used for every data sheet value and answer.
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/Button";

const MESSAGE_VISIBLE_MS = 2_000;

type CopyState = "idle" | "copied" | "failed";

type CopyButtonProps = {
  text: string;
  // What is being copied, for the button's accessible name: "Copy Email address".
  label: string;
};

export function CopyButton({ text, label }: CopyButtonProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<CopyState>("idle");

  // Clear the message after a moment. The cleanup also covers leaving the screen early.
  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), MESSAGE_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  async function copyText(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      // The browser may refuse (no permission, or an old browser). The person can still select and copy.
      setState("failed");
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="ghost" size="small" aria-label={t("common:copy.copyLabel", { label })} onClick={() => void copyText()}>
        {state === "copied" ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
        {t("common:copy.copy")}
      </Button>
      {/* Always in the page, so the screen reader is already listening when the text appears. */}
      <span role="status" className={state === "failed" ? "text-xs text-danger" : "text-xs text-success"}>
        {state === "copied" && t("common:copy.copied")}
        {state === "failed" && t("common:copy.failed")}
      </span>
    </span>
  );
}
