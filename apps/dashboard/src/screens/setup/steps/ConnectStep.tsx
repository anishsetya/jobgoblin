// Step 2: connect Claude. The card shows what is missing and offers Install, then Sign in. Continue unlocks
// once Claude is connected; the card checks again every few seconds, so signing in on Anthropic's page is noticed.
import { useTranslation } from "react-i18next";
import { useClaudeStatus } from "@/api/claude";
import { ClaudeConnection } from "@/components/ClaudeConnection";
import { SetupFrame } from "../SetupFrame";

export function ConnectStep() {
  const { t } = useTranslation();
  const status = useClaudeStatus({ recheckUntilConnected: true });

  return (
    <SetupFrame
      step={2}
      title={t("setup:connect.title")}
      description={t("setup:connect.description")}
      canContinue={status.data?.state === "connected"}
    >
      <ClaudeConnection recheckUntilConnected />
    </SetupFrame>
  );
}
