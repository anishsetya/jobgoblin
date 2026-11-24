// What the person sees when a screen cannot open, for example when Jobgoblin is no longer running.
// It shows the same plain message as any other error: a screen file that could not be fetched, like a request
// that got no answer, says "Jobgoblin could not be reached" (see lazyScreen.tsx). Try again is the caller's.
// Inside the sidebar frame (inFrame) it fills only the main area, so the sidebar stays and the person can go
// elsewhere. Outside it (the first redirect, the setup wizard) it is the whole page, so it brings its own <main>
// and the connection banner the frame would have shown.
import { useTranslation } from "react-i18next";
import { usePageTitle } from "@/lib/pageTitle";
import { ConnectionBanner } from "./ConnectionBanner";
import { ErrorNotice } from "./ErrorNotice";

type RouteErrorScreenProps = {
  error: unknown;
  onRetry: () => void;
  inFrame: boolean;
};

export function RouteErrorScreen({ error, onRetry, inFrame }: RouteErrorScreenProps) {
  const { t } = useTranslation();
  usePageTitle(t("common:routeError.title"));

  const content = (
    <>
      <h1 className="text-2xl font-semibold">{t("common:routeError.title")}</h1>
      <ErrorNotice error={error} onRetry={onRetry} />
    </>
  );

  if (inFrame) return <div className="max-w-xl space-y-4">{content}</div>;
  return (
    <main className="mx-auto max-w-xl space-y-4 px-4 py-16">
      <ConnectionBanner />
      {content}
    </main>
  );
}
