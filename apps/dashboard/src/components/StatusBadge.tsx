// An application's status as a label. Green only for the good outcomes; amber only when the
// application is stuck waiting for the person. Everything else is neutral.
import type { ApplicationStatus } from "@jobgoblin/schemas";
import { useTranslation } from "react-i18next";
import { Badge } from "./ui/Badge";

const SUCCESS_STATUSES: readonly ApplicationStatus[] = ["Applied", "Offer", "Accepted"];
const ATTENTION_STATUSES: readonly ApplicationStatus[] = ["Needs your input"];

function toneFor(status: ApplicationStatus): "green" | "amber" | "neutral" {
  if (SUCCESS_STATUSES.includes(status)) return "green";
  if (ATTENTION_STATUSES.includes(status)) return "amber";
  return "neutral";
}

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  const { t } = useTranslation();
  return <Badge tone={toneFor(status)}>{t(`common:status.${status}`)}</Badge>;
}
