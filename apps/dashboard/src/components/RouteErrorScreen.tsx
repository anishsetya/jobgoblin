// What the person sees when a screen cannot load at all, for example when the local app is not running.
// It shows the same plain message as any other error, and "Try again" asks the router to load the screen again.
import { useTranslation } from "react-i18next";
import { ErrorNotice } from "./ErrorNotice";

export function RouteErrorScreen({ error, reset }: { error: unknown; reset: () => void }) {
  const { t } = useTranslation();

  return (
    <main className="mx-auto max-w-xl space-y-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">{t("common:routeError.title")}</h1>
      <ErrorNotice error={error} onRetry={reset} />
    </main>
  );
}
