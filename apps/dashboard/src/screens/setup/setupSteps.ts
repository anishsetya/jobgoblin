// The steps of the setup wizard, and the hook that moves between them.
// 1 Welcome, 2 Connect Claude, 3 Your folder, 4 Your resume, 5 Your story, 6 Form answers, 7 Targets, 8 Finish.
// Spec: PRD "Setup wizard: seven screens with one task each and a progress bar", ARCHITECTURE.md section 12.
import { useNavigate } from "@tanstack/react-router";

export const SETUP_STEP_COUNT = 8;

// The step number from the address, kept inside 1..8. Anything else starts at the first step.
export function parseSetupStep(value: string): number {
  const step = Number.parseInt(value, 10);
  const isValid = Number.isInteger(step) && step >= 1 && step <= SETUP_STEP_COUNT;
  return isValid ? step : 1;
}

export function useSetupNavigation(step: number): { goBack: () => void; goNext: () => void } {
  const navigate = useNavigate();

  function goToStep(target: number): void {
    void navigate({ to: "/setup/$step", params: { step: String(target) } });
  }

  return {
    goBack: () => goToStep(Math.max(1, step - 1)),
    goNext: () => goToStep(Math.min(SETUP_STEP_COUNT, step + 1)),
  };
}
