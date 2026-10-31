// The frame around every screen except the setup wizard: a sidebar with four places (Today, Pipeline,
// Profile, Settings) and the main area. Spec: PRD "Navigation: sidebar, four places, always visible".
// Landmarks: <nav> for the sidebar and <main> for the screen; the first link on the page skips to <main>.
import { Link, Outlet } from "@tanstack/react-router";
import { Columns3, Inbox, Settings, UserRound } from "lucide-react";
import { Suspense, useRef, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useFocusOnNavigation } from "@/lib/focusOnNavigation";
import { LoadingNote } from "./LoadingNote";

// Applied to every sidebar link; TanStack Router marks the link of the current screen with data-status="active".
const NAV_LINK_CLASSES =
  "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted hover:bg-surface-muted hover:text-text " +
  "data-[status=active]:bg-surface-muted data-[status=active]:font-medium data-[status=active]:text-text";

export function AppShell() {
  const { t } = useTranslation();
  const mainRef = useRef<HTMLElement>(null);
  useFocusOnNavigation(mainRef);

  function skipToMain(event: MouseEvent): void {
    event.preventDefault();
    mainRef.current?.focus();
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[13rem_1fr]">
      <a
        href="#main"
        onClick={skipToMain}
        className="sr-only z-50 rounded-md bg-surface p-3 text-sm focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t("common:skipToContent")}
      </a>

      <div className="border-b border-line bg-surface md:border-r md:border-b-0">
        <div className="px-4 py-4 md:sticky md:top-0 md:py-6">
          <p className="mb-3 px-3 text-base font-semibold">{t("common:appName")}</p>
          <nav aria-label={t("common:nav.label")}>
            <ul className="flex gap-1 overflow-x-auto md:flex-col">
              <li>
                <Link to="/today" className={NAV_LINK_CLASSES}>
                  <Inbox aria-hidden="true" className="size-4" />
                  {t("common:nav.today")}
                </Link>
              </li>
              <li>
                <Link to="/pipeline" className={NAV_LINK_CLASSES}>
                  <Columns3 aria-hidden="true" className="size-4" />
                  {t("common:nav.pipeline")}
                </Link>
              </li>
              <li>
                <Link to="/profile/$tab" params={{ tab: "story" }} className={NAV_LINK_CLASSES}>
                  <UserRound aria-hidden="true" className="size-4" />
                  {t("common:nav.profile")}
                </Link>
              </li>
              <li>
                <Link to="/settings" className={NAV_LINK_CLASSES}>
                  <Settings aria-hidden="true" className="size-4" />
                  {t("common:nav.settings")}
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </div>

      <main id="main" ref={mainRef} tabIndex={-1} className="mx-auto w-full max-w-5xl min-w-0 px-4 py-8 md:px-8">
        {/* Screens other than Today are loaded the first time they are visited; this shows while they load. */}
        <Suspense fallback={<LoadingNote />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
