// Every screen's address, in one place. The route tree is written in code (not generated from files) so a
// reader can see the whole map of the app here:
//
//   /                  decides: setup not finished -> /setup/1, otherwise -> /today
//   /setup/:step       the setup wizard (loaded on demand; it has no sidebar)
//   inside the sidebar frame (AppShell):
//   /today  /review/:id  /apply/:id  /pipeline  /apps/:id  /profile/:tab  /settings
//
// A route component here only reads the address and hands plain props to a screen in src/screens,
// so the screens themselves know nothing about routing and are easy to read on their own.
// Spec: ARCHITECTURE.md section 12.
import type { QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { Suspense, lazy, type ReactElement } from "react";
import { todayQueryOptions } from "@/api/today";
import { AppShell } from "@/components/AppShell";
import { LoadingNote } from "@/components/LoadingNote";
import { NotFoundScreen } from "@/components/NotFoundScreen";
import { RouteErrorScreen } from "@/components/RouteErrorScreen";
import { TodayScreen } from "@/screens/TodayScreen";
import { parsePipelineSearch } from "@/screens/pipeline/pipelineSearch";
import { parseProfileTab } from "@/screens/profile/profileTabs";
import { parseSetupStep } from "@/screens/setup/setupSteps";

// Today is part of the main download because it is the first screen. Every other screen is loaded the first
// time the person goes there, which keeps the first load small. (The wizard is used once, on first run.)
const SetupScreen = lazy(() => import("@/screens/setup/SetupScreen").then((module) => ({ default: module.SetupScreen })));
const ReviewScreen = lazy(() => import("@/screens/ReviewScreen").then((module) => ({ default: module.ReviewScreen })));
const ApplyScreen = lazy(() => import("@/screens/ApplyScreen").then((module) => ({ default: module.ApplyScreen })));
const PipelineScreen = lazy(() => import("@/screens/PipelineScreen").then((module) => ({ default: module.PipelineScreen })));
const ApplicationDetailScreen = lazy(() =>
  import("@/screens/ApplicationDetailScreen").then((module) => ({ default: module.ApplicationDetailScreen })),
);
const ProfileScreen = lazy(() => import("@/screens/ProfileScreen").then((module) => ({ default: module.ProfileScreen })));
const SettingsScreen = lazy(() => import("@/screens/SettingsScreen").then((module) => ({ default: module.SettingsScreen })));

type RouterContext = { queryClient: QueryClient };

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  errorComponent: ({ error, reset }) => <RouteErrorScreen error={error} reset={reset} />,
  notFoundComponent: NotFoundScreen,
});

// "/" is never shown: it sends the person to setup or to Today. The answer comes from the server (Today knows
// whether setup is finished), and it is cached, so Today does not load twice.
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: async ({ context }) => {
    const today = await context.queryClient.fetchQuery(todayQueryOptions());
    if (today.setupComplete) throw redirect({ to: "/today" });
    throw redirect({ to: "/setup/$step", params: { step: "1" } });
  },
});

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup/$step",
  component: function SetupRoute(): ReactElement {
    const { step } = setupRoute.useParams();
    return (
      <Suspense fallback={<LoadingNote />}>
        <SetupScreen step={parseSetupStep(step)} />
      </Suspense>
    );
  },
});

// A route with no path of its own: it only wraps its children in the sidebar frame.
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  component: AppShell,
});

const todayRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/today",
  component: TodayScreen,
});

const reviewRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/review/$id",
  component: function ReviewRoute(): ReactElement {
    const { id } = reviewRoute.useParams();
    return <ReviewScreen applicationId={id} />;
  },
});

const applyRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/apply/$id",
  component: function ApplyRoute(): ReactElement {
    const { id } = applyRoute.useParams();
    return <ApplyScreen applicationId={id} />;
  },
});

const pipelineRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/pipeline",
  validateSearch: parsePipelineSearch,
  component: function PipelineRoute(): ReactElement {
    const search = pipelineRoute.useSearch();
    const navigate = pipelineRoute.useNavigate();
    // Changing a filter replaces the address instead of adding to the history, so Back leaves the screen.
    return <PipelineScreen search={search} onSearchChange={(next) => void navigate({ search: next, replace: true })} />;
  },
});

const applicationRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/apps/$id",
  component: function ApplicationRoute(): ReactElement {
    const { id } = applicationRoute.useParams();
    return <ApplicationDetailScreen applicationId={id} />;
  },
});

const profileRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/profile/$tab",
  // An unknown tab name in the address opens the first tab.
  beforeLoad: ({ params }) => {
    if (parseProfileTab(params.tab) !== params.tab) throw redirect({ to: "/profile/$tab", params: { tab: "story" } });
  },
  component: function ProfileRoute(): ReactElement {
    const { tab } = profileRoute.useParams();
    const navigate = profileRoute.useNavigate();
    return (
      <ProfileScreen tab={parseProfileTab(tab)} onTabChange={(next) => void navigate({ params: { tab: next } })} />
    );
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/settings",
  component: SettingsScreen,
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  setupRoute,
  shellRoute.addChildren([
    todayRoute,
    reviewRoute,
    applyRoute,
    pipelineRoute,
    applicationRoute,
    profileRoute,
    settingsRoute,
  ]),
]);

// Made by main.tsx after the session key has been taken out of the address bar.
export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, scrollRestoration: true });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

// Tells TypeScript about our routes, so every <Link to="..."> and navigate() call is checked against them.
declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
