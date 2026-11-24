// Loads a screen's code the first time the person opens it, like React.lazy, with two differences that matter
// when Jobgoblin cannot be reached (a browser tab that outlived the server, say):
//   - A file that could not be fetched fails with the same "Jobgoblin could not be reached" problem as a request
//     that got no answer, so the error screen says that instead of "something went wrong".
//   - A failed load is not kept for good. React.lazy keeps it, so Try again would fail again even once Jobgoblin
//     is back. Here it is kept only until forgetFailedScreenLoads() (Try again, or leaving the error screen); the
//     next time the screen is shown, its file is fetched again. A load that worked is kept.
// Spec: ARCHITECTURE.md section 12.
import { use, type ComponentType, type ReactElement } from "react";
import { networkProblem } from "@/api/client";

export type ScreenFile<T> = { get(): Promise<T> };

// How to undo each failed load, until forgetFailedScreenLoads() uses them.
const failedLoads = new Set<() => void>();

export function lazyScreen<Props extends object>(
  load: () => Promise<ComponentType<Props>>,
): (props: Props) => ReactElement {
  const file = screenFile(load);

  return function LazyScreen(props: Props): ReactElement {
    // `use` waits for the file (the nearest Suspense shows "Loading..."), or throws its failure to the route's
    // error screen. It gets the same promise on every render until a failed load is forgotten.
    const Screen = use(file.get());
    return <Screen {...props} />;
  };
}

// The loading and forgetting on their own, without React (exported for the tests).
export function screenFile<T>(load: () => Promise<T>): ScreenFile<T> {
  let loading: Promise<T> | null = null;

  return {
    get() {
      loading ??= load().catch((error: unknown) => {
        console.error("A screen's file could not be loaded.", error); // for whoever is debugging
        failedLoads.add(() => {
          loading = null;
        });
        throw networkProblem();
      });
      return loading;
    },
  };
}

// The next time a screen whose file failed is shown, its file is fetched again.
export function forgetFailedScreenLoads(): void {
  for (const forget of failedLoads) forget();
  failedLoads.clear();
}
