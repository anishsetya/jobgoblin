// Single-key shortcuts for a screen (Review uses A, E, S, J and K). Spec: PRD "Interaction rules".
// A shortcut must never fire while the person is typing, so keys pressed in a field are ignored,
// and so are keys pressed together with Ctrl, Alt or Cmd (those belong to the browser).
import { useEffect } from "react";

export type Shortcuts = Record<string, () => void>;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

// `shortcuts` maps a lowercase key ("a") to what it does. Pass enabled=false while a dialog is open.
export function useKeyboardShortcuts(shortcuts: Shortcuts, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (isTypingTarget(event.target)) return;
      const action = shortcuts[event.key.toLowerCase()];
      if (action === undefined) return;
      event.preventDefault();
      action();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts, enabled]);
}
