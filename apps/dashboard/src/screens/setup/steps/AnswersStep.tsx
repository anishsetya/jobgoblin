// Step 6: form answers. These are the things application forms ask: contact details, work authorization,
// notice period, pay, equal-opportunity answers. Values Claude suggested from the resume are already filled in
// for the person to check; saving them is what confirms them. Missing values are marked. Spec: PRD P3.
import { useTranslation } from "react-i18next";
import { FormAnswersForm } from "@/components/FormAnswersForm";
import { SetupFrame } from "../SetupFrame";
import { useSetupNavigation } from "../setupSteps";

export function AnswersStep() {
  const { t } = useTranslation();
  const { goNext } = useSetupNavigation(6);

  return (
    <SetupFrame step={6} title={t("setup:answers.title")} description={t("setup:answers.description")} hideContinue>
      <FormAnswersForm saveLabel={t("setup:saveAndContinue")} onSaved={goNext} />
    </SetupFrame>
  );
}
