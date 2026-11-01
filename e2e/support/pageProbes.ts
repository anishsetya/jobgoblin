// Small helpers that watch the page while a test does something else.
// A run card changes its sentence every second or so; a test that only looks at the end would never prove
// the person saw plain words along the way, so these record what was on screen.
import type { Page } from "@playwright/test";

declare global {
  interface Window {
    __runCardTexts?: Set<string>;
  }
}

// Call BEFORE page.goto. Remembers every distinct text a run card showed (title, step, progress).
export async function startRecordingRunCards(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen = new Set<string>();
    window.__runCardTexts = seen;

    function look(): void {
      for (const card of document.querySelectorAll('[data-testid="run-card"]')) {
        const text = (card as HTMLElement).innerText.replace(/\s+/g, " ").trim();
        if (text !== "") seen.add(text);
      }
    }

    new MutationObserver(look).observe(document, { subtree: true, childList: true, characterData: true });
  });
}

export async function recordedRunCardTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window.__runCardTexts ?? [])]);
}
