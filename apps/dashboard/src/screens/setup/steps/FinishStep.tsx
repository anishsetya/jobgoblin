// Step 8: Finish. A short summary of what is ready, then one button. Finishing builds the person's main resume
// from the confirmed items and marks setup complete; the next stop is Today. Spec: ARCHITECTURE.md D7.
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useProfile } from "@/api/profile";
import { useFinishSetup } from "@/api/settings";
import { useStory } from "@/api/story";
import { ErrorNotice } from "@/components/ErrorNotice";
import { SetupFrame } from "../SetupFrame";

export function FinishStep() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const story = useStory();
  const profile = useProfile();
  const finishSetup = useFinishSetup();

  const confirmedCount = (story.data ?? []).filter((item) => item.status === "confirmed").length;
  const missingCount = profile.data?.missing.length ?? 0;

  return (
    <SetupFrame
      step={8}
      title={t("setup:finish.title")}
      description={t("setup:finish.description")}
      continueLabel={t("setup:finish.action")}
      isWorking={finishSetup.isPending}
      onContinue={() => finishSetup.mutate(undefined, { onSuccess: () => void navigate({ to: "/today" }) })}
    >
      <div className="space-y-4 text-sm">
        <ul className="list-disc space-y-1 pl-5">
          <li>{t("setup:finish.confirmed", { count: confirmedCount })}</li>
          {missingCount > 0 ? (
            <li className="text-flag">{t("setup:finish.missing", { count: missingCount })}</li>
          ) : (
            <li>{t("setup:finish.noneMissing")}</li>
          )}
        </ul>
        <p className="text-muted">{t("setup:finish.next")}</p>
        <ErrorNotice error={finishSetup.error} />
      </div>
    </SetupFrame>
  );
}
