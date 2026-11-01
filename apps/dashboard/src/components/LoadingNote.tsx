// "Loading..." for a screen or panel whose data has not arrived yet. role="status" lets a screen reader say it.
import { useTranslation } from "react-i18next";

export function LoadingNote() {
  const { t } = useTranslation();
  return (
    <p role="status" className="py-8 text-center text-sm text-muted">
      {t("common:loading")}
    </p>
  );
}
