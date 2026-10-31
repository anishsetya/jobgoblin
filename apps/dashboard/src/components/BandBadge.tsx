// A fit band as a label: Strong match, Stretch, Long shot or Low fit. A long shot is the one risk worth amber.
import type { Band } from "@jobgoblin/schemas";
import { useTranslation } from "react-i18next";
import { Badge } from "./ui/Badge";

export function BandBadge({ band }: { band: Band }) {
  const { t } = useTranslation();
  return <Badge tone={band === "long-shot" ? "amber" : "neutral"}>{t(`common:band.${band}`)}</Badge>;
}
