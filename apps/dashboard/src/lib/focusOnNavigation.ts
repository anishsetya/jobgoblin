// Moves keyboard focus to the main area after the person goes to another screen, so a screen reader
// reads the new screen instead of staying on the link that was just used. The browser does this
// for real page loads, but a single-page app has to do it by hand.
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, type RefObject } from "react";

// Switching tabs inside Profile changes the address too, but focus must stay on the tab the
// person just chose, so all tabs count as one place.
function placeFor(pathname: string): string {
  return pathname.startsWith("/profile/") ? "/profile" : pathname;
}

export function useFocusOnNavigation(target: RefObject<HTMLElement | null>): void {
  const place = useRouterState({ select: (state) => placeFor(state.location.pathname) });
  const isFirstScreen = useRef(true);

  useEffect(() => {
    if (isFirstScreen.current) {
      isFirstScreen.current = false;
      return;
    }
    target.current?.focus();
  }, [place, target]);
}
