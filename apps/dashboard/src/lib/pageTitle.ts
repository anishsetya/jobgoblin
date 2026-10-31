// Sets the browser tab's title for the current screen. Screen readers announce it when the person
// moves between screens (WCAG 2.4.2: pages have titles that describe their purpose).
import { useEffect } from "react";

const APP_NAME = "Jobgoblin";

export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} - ${APP_NAME}`;
  }, [title]);
}
