// Shown for an address that does not match any screen. One calm sentence and a way back to Today.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { EmptyState } from "./EmptyState";
import { Button } from "./ui/Button";

export function NotFoundScreen() {
  const { t } = useTranslation();

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <EmptyState
        title={t("common:notFound.title")}
        description={t("common:notFound.description")}
        headingLevel={2}
        action={
          <Button asChild variant="accent">
            <Link to="/today">{t("common:notFound.action")}</Link>
          </Button>
        }
      />
    </main>
  );
}
