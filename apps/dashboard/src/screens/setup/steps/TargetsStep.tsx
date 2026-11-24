// Step 7: targets. What kind of job the person wants, and what to leave out or point out (roles to avoid, jobs
// to skip, risks to flag). Where they can work and how senior a job may be follow from step 6 and are shown
// here read-only. Saved targets change the next Find jobs run. Spec: PRD P4.
import { useTranslation } from "react-i18next";
import { TargetsForm } from "@/components/TargetsForm";
import { SetupFrame } from "../SetupFrame";
import { useSetupNavigation } from "../setupSteps";

export function TargetsStep() {
  const { t } = useTranslation();
  const { goNext } = useSetupNavigation(7);

  return (
    <SetupFrame step={7} title={t("setup:targets.title")} description={t("setup:targets.description")} hideContinue>
      <TargetsForm saveLabel={t("setup:saveAndContinue")} onSaved={goNext} />
    </SetupFrame>
  );
}
