// J7: keyboard only. From Today to Review, Approve, Open application and "I submitted", with no mouse after the
// page is open. Is focus visible and logical? Do shortcuts stay quiet while typing? Is anything unreachable?
import type { Page } from "@playwright/test";
import { test, expect } from "./auditFixtures";
import { writeEvidence } from "./common";
import { auditPath } from "./paths";
import { finding } from "./record";
import { completeWizardViaUi } from "./wizard";
import { ACME, applicationIdFromUrl, findJobsAndWaitForReview } from "../support/flows";
import { waitUntilNoRunIsActive } from "../support/waits";

type Stop = { role: string; name: string; hasFocusRing: boolean; tag: string; inViewport: boolean };

async function focused(page: Page): Promise<Stop> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (el === null || el === document.body) return { role: "", name: "(body)", hasFocusRing: false, tag: "BODY", inViewport: true };
    const style = getComputedStyle(el);
    const ring =
      (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) ||
      (style.boxShadow !== "none" && style.boxShadow !== "") ||
      el.matches(":focus-visible");
    const rect = el.getBoundingClientRect();
    const name = el.getAttribute("aria-label") ?? (el as HTMLInputElement).labels?.[0]?.innerText ?? el.innerText ?? el.getAttribute("value") ?? "";
    return {
      role: el.getAttribute("role") ?? el.tagName.toLowerCase(),
      name: name.replace(/\s+/g, " ").trim().slice(0, 80),
      hasFocusRing: ring,
      tag: el.tagName,
      inViewport: rect.bottom > 0 && rect.top < window.innerHeight,
    };
  });
}

// Presses Tab until the focused element satisfies the test. Returns every stop on the way.
async function tabUntil(page: Page, match: (stop: Stop) => boolean, max = 80): Promise<{ stops: Stop[]; found: boolean }> {
  const stops: Stop[] = [];
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press("Tab");
    const stop = await focused(page);
    stops.push(stop);
    if (match(stop)) return { stops, found: true };
  }
  return { stops, found: false };
}

test("J7: keyboard only, from Today to I submitted", async ({ page, startServer }) => {
  const server = await startServer({ seed: "none" });
  await completeWizardViaUi(page, server);
  await findJobsAndWaitForReview(page);
  const ev: Record<string, unknown> = {};
  let keys = 0;

  // Start from a fresh Today page with nothing focused, as after opening the app.
  await page.goto(`${server.origin}/today`);
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Find jobs" })).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  // 1. Today: Tab to Acme's Review link
  const todayStops = await tabUntil(page, (s) => s.role === "a" && s.name === "Review" && s.inViewport === true, 60);
  // the first Review link on the list belongs to the first item; find Acme's by looking at the list order afterwards
  ev.todayTabStops = todayStops.stops;
  ev.todaySkipLinkFirst = todayStops.stops[0]?.name;
  keys += todayStops.stops.length;
  await page.screenshot({ path: auditPath("screens", "j7", "01-today-focus.png") });

  // Which application does that Review link open?
  const reviewHref = await page.evaluate(() => (document.activeElement as HTMLAnchorElement).getAttribute("href"));
  await page.keyboard.press("Enter");
  keys += 1;
  await expect(page).toHaveURL(/\/review\//);
  await expect(page.getByRole("article", { name: "Resume preview" })).toBeVisible();
  const title = await page.getByRole("heading", { level: 1 }).first().innerText();
  ev.firstReviewOpened = { reviewHref, title };
  await page.screenshot({ path: auditPath("screens", "j7", "02-review-opened.png") });

  // 2. Review: where does focus start, and can she reach Approve by Tab?
  ev.reviewInitialFocus = await focused(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const reviewTabs = await tabUntil(page, (s) => s.role === "button" && s.name === "Approve", 40);
  ev.reviewTabStopsToApprove = reviewTabs.stops;
  ev.approveReachable = reviewTabs.found;
  keys += reviewTabs.stops.length;
  await page.screenshot({ path: auditPath("screens", "j7", "03-review-approve-focused.png") });

  // Everything interactive on Review: is each reachable by Tab?
  const interactive = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]")]
      .filter((el) => !el.hasAttribute("disabled") && el.getAttribute("tabindex") !== "-1" && el.getBoundingClientRect().width > 0)
      .map((el) => (el.getAttribute("aria-label") ?? el.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 60) || el.tagName),
  );
  const seen = new Set<string>();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < interactive.length + 15; i += 1) {
    await page.keyboard.press("Tab");
    seen.add((await focused(page)).name);
  }
  const unreachable = interactive.filter((name) => !seen.has(name) && name !== "");
  ev.interactiveOnReview = interactive.length;
  ev.unreachableOnReview = unreachable;

  // Enter on Approve (the button, not the A shortcut)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const again = await tabUntil(page, (s) => s.role === "button" && s.name === "Approve", 40);
  expect(again.found).toBe(true);
  await page.keyboard.press("Enter");
  keys += again.stops.length + 1;
  await waitUntilNoRunIsActive(server, 120_000);
  ev.afterApproveUrl = page.url();
  ev.afterApproveFocus = await focused(page);

  // 3. Today -> Open application (Acme or whichever was approved)
  await page.goto(`${server.origin}/today`);
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(page.getByText("Ready to send").first()).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const open = await tabUntil(page, (s) => s.role === "a" && s.name === "Open application", 60);
  ev.openApplicationFound = open.found;
  ev.openApplicationStops = open.stops.length;
  keys += open.stops.length;
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/apply\//);
  await expect(page.getByRole("table", { name: "Every value that will be sent with this application" })).toBeVisible();
  const applicationId = applicationIdFromUrl(page);
  await page.screenshot({ path: auditPath("screens", "j7", "04-apply-opened.png") });

  // 4. Copy buttons by keyboard, then "I submitted"
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const copy = await tabUntil(page, (s) => s.role === "button" && /^Copy/.test(s.name), 40);
  ev.firstCopyButtonStops = copy.stops.length;
  await page.keyboard.press("Enter");
  keys += copy.stops.length + 1;
  ev.copyConfirmationVisible = await page.getByText("Copied").first().isVisible().catch(() => false);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const submit = await tabUntil(page, (s) => s.role === "button" && s.name === "I submitted", 80);
  ev.submittedButtonFound = submit.found;
  ev.submittedButtonStops = submit.stops.length;
  keys += submit.stops.length;
  await page.screenshot({ path: auditPath("screens", "j7", "05-i-submitted-focused.png") });
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Record that you applied" });
  await expect(dialog).toBeVisible();
  ev.dialogInitialFocus = await focused(page);
  await page.screenshot({ path: auditPath("screens", "j7", "06-dialog-open.png") });

  // typing in the dialog field must not trigger shortcuts (a s e j k)
  const field = dialog.locator("textarea, input[type=text], input[type=url]").first();
  const fieldTabs = await tabUntil(page, (s) => s.tag === "TEXTAREA", 12);
  ev.dialogTabsToField = fieldTabs.stops;
  await page.keyboard.type("https://example.invalid/a-s-e-j-k");
  keys += 30;
  ev.fieldValueAfterTyping = await field.inputValue().catch(() => "");
  ev.stillOnApplyAfterTyping = /\/apply\//.test(page.url());

  // focus stays inside the dialog while tabbing 12 times
  let escaped = false;
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => !!document.activeElement?.closest("[role='dialog']"));
    if (!inside) escaped = true;
  }
  ev.focusEscapedDialog = escaped;
  // Back to the Record button
  const record = await tabUntil(page, (s) => s.role === "button" && s.name === "Record as applied", 20);
  ev.recordButtonReachable = record.found;
  await page.screenshot({ path: auditPath("screens", "j7", "07-record-focused.png") });
  await page.keyboard.press("Enter");
  keys += record.stops.length + 1;
  await expect(page).toHaveURL(new RegExp(`/apps/${applicationId}$`), { timeout: 20_000 });
  ev.finalApplied = await page.getByText("Applied", { exact: true }).first().isVisible();
  ev.keyPressesApprox = keys;
  ev.focusAfterNavigation = await focused(page);
  await page.screenshot({ path: auditPath("screens", "j7", "08-applied.png") });
  writeEvidence("j7-evidence.json", ev);

  // ---- judgement
  const allStops = [...todayStops.stops, ...reviewTabs.stops, ...open.stops, ...copy.stops, ...submit.stops];
  const noRing = allStops.filter((stop) => !stop.hasFocusRing && stop.name !== "(body)");
  const offscreen = allStops.filter((stop) => !stop.inViewport);
  expect.soft(noRing.length, "every focus stop has a visible ring").toBe(0);
  if (noRing.length > 0) {
    finding({
      id: "J7-1",
      severity: "P2",
      title: "Some controls take keyboard focus without a visible focus indicator",
      persona: "Both",
      area: "Keyboard",
      prd: "Accessibility (WCAG 2.4.7)",
      expected: "A visible ring on every focused control",
      actual: `Without ring: ${JSON.stringify(noRing.map((s) => `${s.role}:${s.name}`).slice(0, 12))}`,
      evidence: [auditPath("j7-evidence.json"), auditPath("screens", "j7")],
      wrong: "product",
    });
  }
  if (!reviewTabs.found || unreachable.length > 0 || !open.found || !submit.found || escapedFlag(ev)) {
    finding({
      id: "J7-2",
      severity: "P1",
      title: "Part of the apply path cannot be done by keyboard alone",
      persona: "Both",
      area: "Keyboard",
      prd: "Accessibility",
      expected: "Approve, Open application, I submitted and Record as applied reachable with Tab and Enter",
      actual: JSON.stringify({ approveReachable: reviewTabs.found, openApplication: open.found, submitted: submit.found, unreachableOnReview: unreachable, focusEscapedDialog: ev.focusEscapedDialog }),
      evidence: [auditPath("j7-evidence.json")],
      wrong: "product",
    });
  }
  if (offscreen.length > 0) {
    finding({
      id: "J7-3",
      severity: "P3",
      title: "Focus moves to controls that are off screen without scrolling them into view",
      persona: "Both",
      area: "Keyboard",
      prd: "Accessibility (WCAG 2.4.7)",
      expected: "The focused control is visible",
      actual: JSON.stringify(offscreen.map((s) => s.name).slice(0, 8)),
      evidence: [auditPath("j7-evidence.json")],
      wrong: "product",
    });
  }
  if (submit.stops.length > 15) {
    finding({
      id: "J7-4",
      severity: "P3",
      title: `On Open application, the main action 'I submitted' takes ${submit.stops.length} Tab presses to reach, after one Copy button per field`,
      persona: "Both",
      area: "Open application (keyboard)",
      prd: "Accessibility, 'Interaction rules'",
      expected: "A shortcut or a landmark/skip link to the actions at the bottom of the page.",
      actual: `${submit.stops.length} Tab presses from the top of the page to I submitted; 'Review' needs 2 Tab presses to reach Approve.`,
      evidence: [auditPath("j7-evidence.json"), auditPath("screens", "j7", "05-i-submitted-focused.png")],
      wrong: "product",
    });
  }
  void ACME;
});

function escapedFlag(ev: Record<string, unknown>): boolean {
  return ev.focusEscapedDialog === true;
}



