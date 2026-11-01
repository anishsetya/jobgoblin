// The setup wizard: eight steps, one task each. This file only picks the step to show; each step is its own
// file under ./steps. The router loads this screen on demand (it is only needed once, on first use).
// Spec: PRD "Setup wizard", ARCHITECTURE.md section 12 (/setup/:step).
import type { ComponentType } from "react";
import { AnswersStep } from "./steps/AnswersStep";
import { ConnectStep } from "./steps/ConnectStep";
import { FinishStep } from "./steps/FinishStep";
import { FolderStep } from "./steps/FolderStep";
import { ResumeStep } from "./steps/ResumeStep";
import { StoryStep } from "./steps/StoryStep";
import { TargetsStep } from "./steps/TargetsStep";
import { WelcomeStep } from "./steps/WelcomeStep";

const STEPS: Record<number, ComponentType> = {
  1: WelcomeStep,
  2: ConnectStep,
  3: FolderStep,
  4: ResumeStep,
  5: StoryStep,
  6: AnswersStep,
  7: TargetsStep,
  8: FinishStep,
};

export function SetupScreen({ step }: { step: number }) {
  const Step = STEPS[step] ?? WelcomeStep;
  return <Step />;
}
