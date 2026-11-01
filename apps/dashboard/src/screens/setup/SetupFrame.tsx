// The frame every setup step sits in: a progress bar, the step's title as the screen's only h1, the step itself,
// and Back / Continue at the bottom. Setup has no sidebar, so this frame supplies the page's <main> landmark.
// Continue stays disabled until the step's task is done, so nobody walks past a step by accident.
import type { ReactNode } from "react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useFocusOnNavigation } from "@/lib/focusOnNavigation";
import { usePageTitle } from "@/lib/pageTitle";
import { SETUP_STEP_COUNT, useSetupNavigation } from "./setupSteps";

const CONTINUE_HINT_ID = "setup-continue-hint";

type SetupFrameProps = {
  step: number;
  title: string;
  description?: string;
  children: ReactNode;
  // Steps with their own "Save and continue" button hide the frame's Continue button.
  hideContinue?: boolean;
  canContinue?: boolean;
  // Shown under Continue while it is disabled, so nobody is left wondering what is missing.
  continueHint?: string;
  continueLabel?: string;
  // What Continue does instead of going to the next step (the last step finishes setup).
  onContinue?: () => void;
  isWorking?: boolean;
};

export function SetupFrame({
  step,
  title,
  description,
  children,
  hideContinue = false,
  canContinue = true,
  continueHint,
  continueLabel,
  onContinue,
  isWorking = false,
}: SetupFrameProps) {
  const { t } = useTranslation();
  const { goBack, goNext } = useSetupNavigation(step);
  const mainRef = useRef<HTMLElement>(null);
  useFocusOnNavigation(mainRef);
  usePageTitle(title);

  const stepLabel = t("setup:progress", { current: step, total: SETUP_STEP_COUNT });
  const isContinueDisabled = !canContinue || isWorking;
  const showHint = isContinueDisabled && continueHint !== undefined && continueHint !== "";

  return (
    <div className="px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="space-y-2">
          <p className="text-base font-semibold">{t("common:appName")}</p>
          <ProgressBar value={step} max={SETUP_STEP_COUNT} label={t("setup:progressLabel")} />
          <p className="text-sm text-muted">{stepLabel}</p>
        </div>

        <main ref={mainRef} tabIndex={-1} className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">{title}</h1>
            {description !== undefined && <p className="text-sm text-muted">{description}</p>}
          </div>

          {children}

          <nav aria-label={t("setup:navLabel")} className="flex items-start justify-between gap-3 border-t border-line pt-6">
            {step > 1 ? <Button onClick={goBack}>{t("common:actions.back")}</Button> : <span />}
            {!hideContinue && (
              <div className="flex flex-col items-end gap-1.5">
                <Button
                  variant="accent"
                  disabled={isContinueDisabled}
                  aria-describedby={showHint ? CONTINUE_HINT_ID : undefined}
                  onClick={onContinue ?? goNext}
                >
                  {continueLabel ?? t("common:actions.continue")}
                </Button>
                {showHint && (
                  <p id={CONTINUE_HINT_ID} className="max-w-xs text-right text-sm text-muted">
                    {continueHint}
                  </p>
                )}
              </div>
            )}
          </nav>
        </main>
      </div>
    </div>
  );
}
