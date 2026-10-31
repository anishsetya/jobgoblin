// The root of the app: starts listening for the server's live updates and shows the current screen.
// The live updates are why no screen needs a refresh button: when a run makes progress or an application
// changes, the matching data is fetched again and every screen showing it redraws (see api/liveUpdates.ts).
import { RouterProvider } from "@tanstack/react-router";
import { useLiveUpdates } from "@/api/liveUpdates";
import type { AppRouter } from "@/router";

export function App({ router }: { router: AppRouter }) {
  useLiveUpdates();
  return <RouterProvider router={router} />;
}
