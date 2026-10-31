// Step 1: what Jobgoblin does and what the next minutes look like. No task yet, just a calm start.
import { useTranslation } from "react-i18next";
import { SetupFrame } from "../SetupFrame";

const WHAT_HAPPENS = ["connect", "folder", "resume", "story", "answers", "targets"] as const;

export function WelcomeStep() {
  const { t } = useTranslation();

  return (
    <SetupFrame step={1} title={t("setup:welcome.title")} description={t("setup:welcome.description")} continueLabel={t("setup:welcome.start")}>
      <div className="space-y-4 text-sm">
        <p>{t("setup:welcome.promise")}</p>
        <h2 className="text-base font-semibold">{t("setup:welcome.whatHappens")}</h2>
        <ol className="list-decimal space-y-1 pl-5">
          {WHAT_HAPPENS.map((item) => (
            <li key={item}>{t(`setup:welcome.steps.${item}`)}</li>
          ))}
        </ol>
        <p className="text-muted">{t("setup:welcome.time")}</p>
      </div>
    </SetupFrame>
  );
}
