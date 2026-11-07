// Section D: the UX sweep. Every screen and state, light and dark, 1280x800: a screenshot, the voice scan, accent button
// count, horizontal overflow, axe. Then overflow at smaller sizes and 200% zoom, speed, and consistency of words.
// The screenshots are for a person (Sonnet) to look at: AUDIT_DIR/screens/ux/<light|dark>/*.png
import fs from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect } from "./auditFixtures";
import { makeFlakyClaude, makeInstallStub, removeDir, runCards, tempDir, withNoClaudeOnThisMachine } from "./helpers";
import { writeEvidence } from "./common";
import { auditPath } from "./paths";
import { check } from "./record";
import { seedVariant } from "./seedVariants";
import { sweep, type SweepResult } from "./sweep";
import { RESUME_PDF } from "../support/seed";
import { waitUntilNoRunIsActive } from "../support/waits";
import { ACME, COPPERLEAF, needsYouItem } from "../support/flows";

type Shot = Omit<SweepResult, "text"> & { name: string; scheme: string };

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

class Shooter {
  readonly shots: Shot[] = [];
  readonly corpus: Record<string, string> = {};
  readonly timings: { screen: string; ms: number }[] = [];
  constructor(private readonly page: Page) {}

  async shoot(name: string): Promise<void> {
    for (const scheme of ["light", "dark"] as const) {
      await this.page.emulateMedia({ colorScheme: scheme });
      await this.page.waitForTimeout(150);
      const result = await sweep(this.page, `${name} [${scheme}]`, { screenshot: `screens/ux/${scheme}/${slug(name)}.png` });
      const { text, ...summary } = result;
      // Accent buttons a person could press: not disabled, and inside the open dialog when there is one.
      const enabledAccent = await this.page.evaluate(() => {
        const scope = document.querySelector("[role=dialog]") ?? document.body;
        return [...scope.querySelectorAll("button, a")].filter((element) => {
          const rect = element.getBoundingClientRect();
          const className = typeof element.className === "string" ? element.className : "";
          return /\bbg-accent\b/.test(className) && rect.width > 0 && rect.height > 0 && !(element as HTMLButtonElement).disabled && element.getAttribute("aria-disabled") !== "true";
        }).length;
      });
      this.shots.push({ ...summary, accentButtons: enabledAccent, name, scheme });
      if (scheme === "light") this.corpus[name] = text;
    }
    await this.page.emulateMedia({ colorScheme: "light" });
  }

  // Time a navigation the way a person feels it: from the click or address to the screen's heading.
  async timed(screen: string, go: () => Promise<void>, ready: () => Promise<unknown>): Promise<void> {
    const begun = Date.now();
    await go();
    await ready();
    this.timings.push({ screen, ms: Date.now() - begun });
  }

  save(prefix: string): { shots: Shot[]; evidence: string } {
    const evidence = writeEvidence(`d-${prefix}-sweep.json`, { shots: this.shots, timings: this.timings });
    writeEvidence(`d-corpus-${prefix}.json`, this.corpus);
    return { shots: this.shots, evidence };
  }
}

test("D UX sweep: every screen and state, light and dark", async ({ page, startServer }) => {
  test.setTimeout(900_000);
  const flaky = makeFlakyClaude();
  try {
    const server = await startServer({ seed: "none", fakeClaudeEnv: flaky.env });
    await seedVariant(server, {
      usageNoticeSeen: false,
      mutateProfile: (profile) => {
        profile.compensation = { expectedBase: "120000" };
      },
    });
    const shooter = new Shooter(page);
    const layoutFacts: Record<string, unknown> = {};
    const heading = (name: string | RegExp) => page.getByRole("heading", { level: 1, name });

    // ---- Today before the first run, the usage notice, Pipeline when empty
    await shooter.timed("Today (first load)", () => page.goto(server.url).then(() => undefined), () => expect(page.getByRole("button", { name: "Find jobs" })).toBeVisible());
    await shooter.shoot("Today fresh start");
    await shooter.timed("Pipeline (empty)", () => page.goto(`${server.origin}/pipeline`).then(() => undefined), () => expect(heading("Pipeline")).toBeVisible());
    await page.waitForTimeout(400);
    await shooter.shoot("Pipeline empty");
    await page.goto(`${server.origin}/today`);
    await page.getByRole("button", { name: "Find jobs" }).click();
    await expect(page.getByRole("dialog", { name: "Before your first run" })).toBeVisible();
    await shooter.shoot("Dialog usage notice");
    flaky.setModes({ hunt: "slow", tailor: "slow" });
    await page.getByRole("button", { name: "I understand, continue" }).click();

    // ---- A run in progress
    await expect(page.getByTestId("run-card").first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(3500);
    await shooter.shoot("Today hunt running");
    await expect(page.getByTestId("run-card").filter({ hasText: "Tailoring resumes" })).toBeVisible({ timeout: 120_000 });
    await page.waitForTimeout(2500);
    await shooter.shoot("Today tailoring running");
    flaky.setModes(null);
    await waitUntilNoRunIsActive(server, 240_000);
    await page.reload();
    await expect(needsYouItem(page, ACME)).toContainText("Ready to review");
    await shooter.shoot("Today needs you");

    // ---- Add a job
    await page.getByRole("button", { name: "Add a job" }).click();
    await shooter.shoot("Dialog add a job (link)");
    await page.getByRole("button", { name: "Paste the job text instead" }).click();
    await shooter.shoot("Dialog add a job (text)");
    await page.keyboard.press("Escape");

    // ---- Review
    const rows = await server.api<{ id: string; company: string; title: string; status: string }[]>("/api/pipeline");
    const acme = rows.find((row) => row.company === "Acme Cloud")!;
    const copperleaf = rows.find((row) => row.title === "Software Engineer, Applied AI")!;
    await shooter.timed("Review", () => page.goto(`${server.origin}/review/${acme.id}`).then(() => undefined), () => expect(page.getByRole("article", { name: "Resume preview" })).toBeVisible());
    await shooter.shoot("Review");
    await page.getByRole("button", { name: "Request edit" }).click();
    await shooter.shoot("Dialog request an edit");
    await page.keyboard.press("Escape");
    await shooter.timed("Application (long shot)", () => page.goto(`${server.origin}/apps/${copperleaf.id}`).then(() => undefined), () => expect(page.getByRole("button", { name: "Tailor a resume" })).toBeVisible());
    await shooter.shoot("Application long shot");

    // ---- Approve (through the API: the click is covered by other specs), Open application
    const detail = await server.api<{ dataSheetHash: string }>(`/api/apps/${acme.id}`);
    await server.api(`/api/apps/${acme.id}/approve`, { body: { dataSheetHash: detail.dataSheetHash, submitMode: "manual" } });
    await waitUntilNoRunIsActive(server, 120_000);
    await page.goto(`${server.origin}/today`);
    await shooter.shoot("Today ready to send");
    await shooter.timed("Open application", () => page.goto(`${server.origin}/apply/${acme.id}`).then(() => undefined), () => expect(page.getByRole("button", { name: "Copy Email address" })).toBeVisible());
    await shooter.shoot("Open application");
    const submittedBox = await page.getByRole("button", { name: "I submitted" }).boundingBox();
    const scrollToSubmitted = await page.evaluate(() => document.documentElement.scrollHeight);
    layoutFacts.submittedButtonTopPx = submittedBox === null ? null : Math.round(submittedBox.y + (await page.evaluate(() => window.scrollY)));
    layoutFacts.openApplicationPageHeightPx = scrollToSubmitted;
    await page.getByRole("button", { name: "I submitted" }).click();
    await shooter.shoot("Dialog record that you applied");
    await page.keyboard.press("Escape");
    await server.api(`/api/apps/${acme.id}/submitted`, { body: { proofType: "person-saw-it", proof: "I saw the confirmation page.", attachedSha256: null } });

    // ---- Application (applied), Pipeline
    await shooter.timed("Application (applied)", () => page.goto(`${server.origin}/apps/${acme.id}`).then(() => undefined), () => expect(page.getByRole("button", { name: "Change status" })).toBeVisible());
    await shooter.shoot("Application applied");
    await page.getByRole("button", { name: "Withdraw" }).click();
    await shooter.shoot("Dialog withdraw");
    await page.keyboard.press("Escape");
    await shooter.timed("Pipeline (board)", () => page.goto(`${server.origin}/pipeline`).then(() => undefined), () => expect(page.getByTestId("pipeline-card").first()).toBeVisible());
    await shooter.shoot("Pipeline board");
    layoutFacts.boardColumns = await page.evaluate(() =>
      ["To review", "Ready to apply", "Applied", "Interviewing", "Offer", "Closed"].map((name) => {
        const heading = [...document.querySelectorAll("h2, h3")].find((element) => (element.textContent ?? "").trim().startsWith(name));
        const rect = heading?.getBoundingClientRect();
        return { name, visibleWithoutScrolling: rect !== undefined && rect.right <= window.innerWidth && rect.left >= 0 };
      }),
    );
    await shooter.timed("Pipeline (list)", () => page.goto(`${server.origin}/pipeline?view=list`).then(() => undefined), () => expect(page.getByRole("table", { name: "Every application" })).toBeVisible());
    await shooter.shoot("Pipeline list");
    await page.goto(`${server.origin}/pipeline?q=zzzz-no-such-job`);
    await page.waitForTimeout(500);
    await shooter.shoot("Pipeline no results");

    // ---- Profile and Settings
    await shooter.timed("Profile: Your story", () => page.goto(`${server.origin}/profile/story`).then(() => undefined), () => expect(page.getByRole("tab", { name: "Your story", selected: true })).toBeVisible());
    await shooter.shoot("Profile your story");
    await page.getByRole("button", { name: "Add to your story" }).click();
    await shooter.shoot("Dialog add to your story");
    await page.keyboard.press("Escape");
    await shooter.timed("Profile: Form answers", () => page.goto(`${server.origin}/profile/answers`).then(() => undefined), () => expect(page.getByLabel("Full name")).toBeVisible());
    await shooter.shoot("Profile form answers");
    await shooter.timed("Profile: Targets", () => page.goto(`${server.origin}/profile/targets`).then(() => undefined), () => expect(page.getByLabel("Job titles you want")).toBeVisible());
    await shooter.shoot("Profile targets");
    await shooter.timed("Profile: Banned words", () => page.goto(`${server.origin}/profile/banned`).then(() => undefined), () => expect(page.getByRole("textbox", { name: "Banned words" })).toBeVisible());
    await shooter.shoot("Profile banned words");
    await shooter.timed("Settings", () => page.goto(`${server.origin}/settings`).then(() => undefined), () => expect(page.getByRole("button", { name: "Back up now" })).toBeVisible());
    await shooter.shoot("Settings");
    await page.getByRole("button", { name: "Back up now" }).click();
    await page.getByRole("button", { name: /^Restore the backup from / }).first().click();
    await shooter.shoot("Dialog restore this backup");
    await page.keyboard.press("Escape");
    await page.goto(`${server.origin}/nope`);
    await shooter.shoot("Not found");

    // ---- Failure states on Today
    await page.goto(`${server.origin}/today`);
    for (const failure of [{ name: "crash", modes: { hunt: "crash" } }, { name: "usage limit", modes: { hunt: "usage-limit" } }, { name: "signed out", modes: { "*": "signed-out" } }]) {
      flaky.setModes(failure.modes);
      await expect(page.getByRole("button", { name: "Find jobs" })).toBeEnabled({ timeout: 20_000 });
      await page.getByRole("button", { name: "Find jobs" }).click();
      await expect.poll(async () => (await runCards(page)).some((card) => card.buttons.some((label) => /^Try again/.test(label))), { timeout: 60_000 }).toBe(true);
      await shooter.shoot(`Today failure ${failure.name}`);
      // The cause goes away; Try again also lets a blocked queue run again. Then the cards are cleared.
      flaky.setModes(null);
      await page.getByTestId("run-card").filter({ has: page.getByRole("button", { name: /^Try again/ }) }).first().getByRole("button", { name: /^Try again/ }).click();
      await waitUntilNoRunIsActive(server, 120_000);
      await page.reload();
      for (let guard = 0; guard < 8; guard += 1) {
        const dismiss = page.getByRole("button", { name: /^Dismiss/ });
        if ((await dismiss.count()) === 0) break;
        await dismiss.first().click();
        await page.waitForTimeout(250);
      }
    }
    flaky.setModes({ "*": "signed-out" });
    await page.goto(`${server.origin}/settings`);
    await expect(page.getByRole("region", { name: "Claude connection" })).toContainText("Not signed in");
    await shooter.shoot("Settings claude signed out");
    flaky.setModes(null);

    // ---- Speed: a progress card within seconds (R1) on a normal run
    await page.goto(`${server.origin}/today`);
    const clicked = Date.now();
    await page.getByRole("button", { name: "Find jobs" }).click();
    await page.getByTestId("run-card").first().waitFor({ state: "visible", timeout: 30_000 });
    const firstCardMs = Date.now() - clicked;
    let firstStepMs: number | null = null;
    const stepDeadline = Date.now() + 30_000;
    while (Date.now() < stepDeadline) {
      const cards = await runCards(page);
      if (cards.some((card) => card.status !== "" && !/Waiting for its turn|Getting started/.test(card.status))) {
        firstStepMs = Date.now() - clicked;
        break;
      }
      await page.waitForTimeout(100);
    }
    await waitUntilNoRunIsActive(server, 180_000);
    const speed = { firstCardMs, firstStepMs, note: "Find jobs clicked on Today (second hunt, nothing new); fake claude, no network" };

    // ---- Overflow at smaller sizes and at 200% zoom (a 1280x800 window at 200% is 640x400 CSS pixels)
    const sizes = [{ w: 1280, h: 800 }, { w: 1024, h: 700 }, { w: 800, h: 600 }, { w: 640, h: 400 }];
    const overflowScreens = [
      { name: "today", url: "/today" },
      { name: "review", url: `/review/${rows.find((row) => row.company === "Brightpath")!.id}` },
      { name: "apply", url: `/apply/${acme.id}` },
      { name: "pipeline-board", url: "/pipeline" },
      { name: "pipeline-list", url: "/pipeline?view=list" },
      { name: "application", url: `/apps/${acme.id}` },
      { name: "profile-answers", url: "/profile/answers" },
      { name: "profile-targets", url: "/profile/targets" },
      { name: "settings", url: "/settings" },
      { name: "wizard-welcome", url: "/setup/1" },
    ];
    const overflow: Record<string, Record<string, unknown>> = {};
    for (const size of sizes) {
      await page.setViewportSize({ width: size.w, height: size.h });
      for (const screen of overflowScreens) {
        await page.goto(`${server.origin}${screen.url}`);
        await page.waitForTimeout(500);
        const measured = await page.evaluate(() => {
          const root = document.scrollingElement ?? document.documentElement;
          const wide = [...document.querySelectorAll("body *")].filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.right > window.innerWidth + 1 && rect.width > 0 && getComputedStyle(element).position !== "fixed";
          });
          return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, widest: wide.slice(0, 3).map((element) => `${element.tagName.toLowerCase()}.${String((element as HTMLElement).className).slice(0, 50)}`) };
        });
        (overflow[`${size.w}x${size.h}`] ??= {})[screen.name] = { overflow: measured.scrollWidth > measured.clientWidth, ...measured };
        if (size.w <= 800 && ["review", "today", "pipeline-board"].includes(screen.name)) {
          await page.screenshot({ path: auditPath("screens", "ux", `size-${size.w}x${size.h}-${screen.name}.png`), fullPage: false });
        }
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    // ---- Save, then judge
    const { shots, evidence } = shooter.save("main");
    writeEvidence("d-speed-and-overflow.json", { speed, timings: shooter.timings, overflow, layoutFacts });
    const hiddenColumns = ((layoutFacts.boardColumns as { name: string; visibleWithoutScrolling: boolean }[]) ?? []).filter((column) => !column.visibleWithoutScrolling).map((column) => column.name);
    check(hiddenColumns.length === 0, { id: "D-board-clipped", severity: "P3", title: "At 1280x800 the Pipeline board shows only part of its columns; the rest need a sideways scroll that is not signposted", persona: "Maya", area: "Pipeline board", prd: "K1", expected: "All six columns visible, or a visible scroll hint", actual: `not visible without scrolling: ${hiddenColumns.join(", ")}`, evidence: [auditPath("d-speed-and-overflow.json"), auditPath("screens", "ux", "light", "pipeline-board.png")], wrong: "product" });
    check(typeof layoutFacts.submittedButtonTopPx === "number" && layoutFacts.submittedButtonTopPx < 1200, { id: "D-submitted-below-fold", severity: "P3", title: "On Open application, the one action that finishes the job ('I submitted') sits after 26 field rows, far below the first screen", persona: "Maya", area: "Open application", prd: "U1, U4", expected: "The next step is visible without a long scroll", actual: JSON.stringify({ topPx: layoutFacts.submittedButtonTopPx, pageHeightPx: layoutFacts.openApplicationPageHeightPx, viewportHeight: 800 }), evidence: [auditPath("d-speed-and-overflow.json"), auditPath("screens", "ux", "light", "open-application.png")], wrong: "product" });

    const bad = (predicate: (shot: Shot) => boolean) => [...new Set(shots.filter(predicate).map((shot) => shot.name))];
    const accent = bad((shot) => shot.accentButtons > 1);
    check(accent.length === 0, { id: "D-accent-buttons", severity: "P3", title: "More than one accent (primary) button on one screen", persona: "Maya", area: accent.join(", "), prd: "Interaction rules (one accent button per screen)", expected: "One", actual: accent.join(", "), evidence: [evidence], wrong: "product" });
    const exclaim = bad((shot) => shot.exclamations.length > 0);
    check(exclaim.length === 0, { id: "D-exclamation", severity: "P3", title: "Exclamation marks in the interface text", persona: "Maya", area: exclaim.join(", "), prd: "Voice rules", expected: "None", actual: JSON.stringify(shots.filter((shot) => shot.exclamations.length > 0).map((shot) => [shot.name, shot.exclamations])), evidence: [evidence], wrong: "product" });
    const raw = bad((shot) => shot.rawKeys.length > 0 || shot.placeholders.length > 0);
    check(raw.length === 0, { id: "D-raw-keys", severity: "P2", title: "Raw translation keys or unfilled {placeholders} are visible", persona: "Maya", area: raw.join(", "), prd: "Voice rules", expected: "None", actual: JSON.stringify(shots.filter((shot) => shot.rawKeys.length || shot.placeholders.length).map((shot) => [shot.name, shot.rawKeys, shot.placeholders])), evidence: [evidence], wrong: "product" });
    const jargon = shots.filter((shot) => shot.scheme === "light" && shot.jargon.filter((word) => word !== "API").length > 0);
    check(jargon.length === 0, { id: "D-jargon", severity: "P3", title: "Technical words on screen", persona: "Maya", area: jargon.map((shot) => shot.name).join(", "), prd: "Voice rules (no MCP, token, prompt, headless, API, JSON)", expected: "None", actual: JSON.stringify(jargon.map((shot) => [shot.name, shot.jargon])), evidence: [evidence], wrong: "product" });
    const overflowing = bad((shot) => shot.horizontalOverflow);
    check(overflowing.length === 0, { id: "D-overflow-1280", severity: "P2", title: "A screen scrolls sideways at 1280x800", persona: "Both", area: overflowing.join(", "), prd: "Layout", expected: "None", actual: overflowing.join(", "), evidence: [evidence], wrong: "product" });
    const small = Object.entries(overflow).flatMap(([size, screens]) => Object.entries(screens).filter(([, value]) => (value as { overflow: boolean }).overflow).map(([name]) => `${name}@${size}`));
    check(small.length === 0, { id: "D-overflow-small", severity: "P2", title: "Screens scroll sideways at smaller windows or 200% zoom", persona: "Both", area: small.join(", "), prd: "Accessibility (reflow)", expected: "No horizontal scroll down to 640 wide", actual: small.join(", "), evidence: [auditPath("d-speed-and-overflow.json")], wrong: "product" });
    const axe = shots.filter((shot) => shot.axeViolations.length > 0);
    check(axe.length === 0, { id: "D-axe", severity: "P2", title: "axe finds WCAG A/AA violations on screens or states the existing accessibility spec does not cover", persona: "Maya", area: [...new Set(axe.map((shot) => `${shot.name} [${shot.scheme}]`))].join(", "), prd: "Accessibility", expected: "None", actual: JSON.stringify(axe.map((shot) => [shot.name, shot.scheme, shot.axeViolations])), evidence: [evidence], wrong: "product" });
    check(firstStepMs !== null && firstStepMs < 5_000, { id: "D-progress-slow", severity: "P2", title: "The progress card with a first step takes more than a few seconds to appear", persona: "Maya", area: "Today run card", prd: "R1", expected: "A card with a step within seconds", actual: JSON.stringify(speed), evidence: [auditPath("d-speed-and-overflow.json")], wrong: "product" });
    void fs;
    void COPPERLEAF;
    void RESUME_PDF;
  } finally {
    flaky.remove();
  }
});

test("D wizard screens, light and dark", async ({ page, startServer }) => {
  test.setTimeout(400_000);
  const server = await startServer({ seed: "none" });
  const shooter = new Shooter(page);
  await page.goto(server.url);
  await expect(page.getByRole("heading", { level: 1, name: "Welcome to Jobgoblin" })).toBeVisible();
  const progress: string[] = [];
  const noteProgress = async (): Promise<void> => {
    progress.push(await page.getByText(/^Step \d+ of \d+$/).first().innerText().catch(() => "(no step counter)"));
  };
  await noteProgress();
  await shooter.shoot("Wizard 1 welcome");
  await page.getByRole("button", { name: "Get started" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Connect Claude" })).toBeVisible();
  await page.waitForTimeout(800);
  await noteProgress();
  await shooter.shoot("Wizard 2 connect claude");
  await page.getByRole("button", { name: "Continue" }).click();
  await noteProgress();
  await shooter.shoot("Wizard 3 folder (before)");
  await page.getByLabel("Folder", { exact: true }).fill(server.personFolder);
  await page.getByRole("button", { name: "Use this folder" }).click();
  await expect(page.getByText(server.personFolder)).toBeVisible();
  await shooter.shoot("Wizard 3 folder (chosen)");
  await page.getByRole("button", { name: "Continue" }).click();
  await noteProgress();
  await shooter.shoot("Wizard 4 resume (before)");
  await page.getByLabel("Your resume", { exact: true }).setInputFiles(RESUME_PDF);
  await shooter.shoot("Wizard 4 resume (file chosen)");
  await page.getByRole("button", { name: "Read my resume" }).click();
  await shooter.shoot("Dialog usage notice (wizard)");
  await page.getByRole("button", { name: "I understand, continue" }).click();
  await page.waitForTimeout(600);
  await shooter.shoot("Wizard 4 resume (reading)");
  await expect(page.getByText("Your resume has been read. Next, check what we found.")).toBeVisible({ timeout: 90_000 });
  await shooter.shoot("Wizard 4 resume (read)");
  await page.getByRole("button", { name: "Continue" }).click();
  await noteProgress();
  await expect(page.getByRole("button", { name: /^Confirm/ }).first()).toBeVisible({ timeout: 30_000 });
  await shooter.shoot("Wizard 5 your story (to confirm)");
  const confirmAll = page.getByRole("button", { name: /^Confirm all/ });
  for (let guard = 0; guard < 80; guard += 1) {
    const remaining = await page.getByRole("button", { name: /^Confirm/ }).count();
    if (remaining === 0) break;
    await ((await confirmAll.count()) > 0 ? confirmAll.first() : page.getByRole("button", { name: /^Confirm/ }).first()).click();
    await expect.poll(() => page.getByRole("button", { name: /^Confirm/ }).count()).toBeLessThan(remaining);
  }
  await shooter.shoot("Wizard 5 your story (done)");
  await page.getByRole("button", { name: "Continue" }).click();
  await noteProgress();
  await expect(page.getByRole("heading", { level: 1, name: "Form answers" })).toBeVisible();
  await shooter.shoot("Wizard 6 form answers");
  await page.getByLabel("Notice period").fill("2 weeks");
  await page.getByLabel("Earliest start date").fill("2026-12-01");
  await page.getByLabel("Expected yearly pay").fill("120000");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await noteProgress();
  await expect(page.getByRole("heading", { level: 1, name: "Your targets" })).toBeVisible();
  await shooter.shoot("Wizard 7 targets");
  await page.getByLabel("Job titles you want").fill("Backend Engineer");
  await page.getByRole("checkbox", { name: "United States" }).check();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await noteProgress();
  await expect(page.getByRole("heading", { level: 1, name: "You are ready" })).toBeVisible();
  await shooter.shoot("Wizard 8 you are ready");
  const { shots, evidence } = shooter.save("wizard");
  writeEvidence("d-wizard-progress.json", progress);
  const distinctTotals = [...new Set(progress.map((text) => /of (\d+)/.exec(text)?.[1]))];
  check(distinctTotals.length === 1 && distinctTotals[0] === "7", { id: "D-wizard-step-count", severity: "P3", title: "The wizard says 'Step n of 8' but the PRD describes seven screens", persona: "Maya", area: "Setup wizard", prd: "S1 (seven screens), PRD journey", expected: "The number the PRD promises, or the PRD updated", actual: `counter reads: ${progress.join(" | ")}`, evidence: [auditPath("d-wizard-progress.json")], wrong: "unclear" });
  const accent = [...new Set(shots.filter((shot) => shot.accentButtons > 1).map((shot) => shot.name))];
  check(accent.length === 0, { id: "D-wizard-accent", severity: "P3", title: "More than one accent button on a wizard screen", persona: "Maya", area: accent.join(", "), prd: "Interaction rules", expected: "One", actual: accent.join(", "), evidence: [evidence], wrong: "product" });
  const axe = shots.filter((shot) => shot.axeViolations.length > 0);
  check(axe.length === 0, { id: "D-wizard-axe", severity: "P2", title: "axe violations on wizard states", persona: "Maya", area: axe.map((shot) => shot.name).join(", "), prd: "Accessibility", expected: "None", actual: JSON.stringify(axe.map((shot) => [shot.name, shot.axeViolations])), evidence: [evidence], wrong: "product" });
});

test("D failure screens without Claude Code", async ({ page, startServer }) => {
  test.setTimeout(240_000);
  const home = tempDir("home");
  const stub = makeInstallStub("fail", home);
  try {
    const server = await withNoClaudeOnThisMachine(home, () =>
      startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true }, fakeClaudeEnv: { JOBGOBLIN_CLAUDE_COMMAND: "", ...stub.env } }),
    );
    const status = await server.api<{ state: string }>("/api/claude/status");
    expect(status.state).toBe("not-installed"); // SAFETY GATE before any click
    const shooter = new Shooter(page);
    await page.goto(`${server.origin}/settings#token=${server.token}`);
    await expect(page.getByRole("region", { name: "Claude connection" })).toContainText("Not installed");
    await shooter.shoot("Settings claude not installed");
    await page.goto(`${server.origin}/setup/2`);
    await expect(page.getByRole("heading", { level: 1, name: "Connect Claude" })).toBeVisible();
    await page.waitForTimeout(600);
    await shooter.shoot("Wizard 2 claude not installed");
    await page.goto(`${server.origin}/today`);
    await page.getByRole("button", { name: "Find jobs" }).click();
    await expect.poll(async () => (await runCards(page)).some((card) => card.buttons.some((label) => /^Dismiss/.test(label))), { timeout: 60_000 }).toBe(true);
    await shooter.shoot("Today failure claude not installed");
    const { shots, evidence } = shooter.save("notinstalled");
    const axe = shots.filter((shot) => shot.axeViolations.length > 0);
    check(axe.length === 0, { id: "D-notinstalled-axe", severity: "P2", title: "axe violations on the not-installed screens", persona: "Maya", area: axe.map((shot) => shot.name).join(", "), prd: "Accessibility", expected: "None", actual: JSON.stringify(axe.map((shot) => [shot.name, shot.axeViolations])), evidence: [evidence], wrong: "product" });
  } finally {
    stub.remove();
    removeDir(home);
  }
});

test("D consistency of words across screens", async () => {
  // Reads the corpus the sweep wrote (d-corpus.json merges are per test run; this test only reads what exists).
  const corpus: Record<string, string> = {};
  for (const prefix of ["main", "wizard", "notinstalled"]) {
    const file = auditPath(`d-corpus-${prefix}.json`);
    if (fs.existsSync(file)) Object.assign(corpus, JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>);
  }
  if (Object.keys(corpus).length === 0) test.skip(true, "run the UX sweep first");
  const all = Object.entries(corpus);
  const where = (pattern: RegExp): string[] => all.filter(([, text]) => pattern.test(text)).map(([name]) => name);
  const facts = {
    "Retry (word)": where(/\bRetry\b/),
    "Try again": where(/Try again/),
    "OA (abbreviation)": where(/\bOA\b/),
    "Online assessment": where(/Online assessment/),
    "Onsite": where(/\bOnsite\b/),
    "Interview round": where(/Interview round/),
    "Interview (alone)": where(/\bInterview\b(?! round)/),
    "No reply": where(/No reply/),
    "Ghosted": where(/Ghosted/),
    "Making resumes": where(/Making resumes/),
    "Tailoring resumes": where(/Tailoring resumes/),
    "Needs attention": where(/Needs attention/),
    "Needs your input": where(/Needs your input/),
    "Open application (title)": where(/Open application/),
  };
  const evidence = writeEvidence("d-word-consistency.json", facts);
  check(!(facts["Making resumes"].length > 0 && facts["Tailoring resumes"].length > 0), { id: "D-run-name-drift", severity: "P3", title: "The same run is called 'Tailoring resumes' on its card and 'Making resumes' in Needs you", persona: "Maya", area: "Today", prd: "Voice consistency", expected: "One name", actual: JSON.stringify({ making: facts["Making resumes"], tailoring: facts["Tailoring resumes"] }), evidence: [evidence], suspectedFile: "packages/server/src/services/today.ts:39 vs apps/dashboard/src/i18n/en/common.json run.kind.tailor", wrong: "product" });
  const blankFrom = where(/moved this from\s+to\s/);
  check(blankFrom.length === 0, { id: "D-history-blank-from", severity: "P3", title: "The history of an application says 'Jobgoblin moved this from to Found' (the first line has no 'from' status)", persona: "Maya", area: blankFrom.join(", "), prd: "Voice", expected: "'added this as Found' or similar", actual: "moved this from to ...", evidence: [evidence], suspectedFile: "apps/dashboard/src/i18n/en/application.json:61 (status-changed has no case for a missing 'from')", wrong: "product" });
  const runningWithFinished = all.filter(([name, text]) => /Today/.test(name) && /\nRunning\n[\s\S]*Finished/.test(text)).map(([name]) => name);
  check(runningWithFinished.length === 0, { id: "D-running-heading-finished", severity: "P3", title: "Today's 'Running' section keeps finished runs ('Finished', Dismiss) under the heading 'Running' until the person dismisses them", persona: "Maya", area: runningWithFinished.join(", "), prd: "Voice / R1", expected: "Finished runs are not listed as Running", actual: runningWithFinished.join(", "), evidence: [evidence], suspectedFile: "apps/dashboard/src/screens/TodayScreen.tsx:110-120; apps/dashboard/src/i18n/en/today.json:49", wrong: "product" });
  const reviewMissing = all.filter(([name, text]) => /^Review$/.test(name) && /(LinkedIn profile|Portfolio or website)\s*\n?\s*Missing/.test(text)).map(([name]) => name);
  check(reviewMissing.length === 0, { id: "D-missing-optional", severity: "P3", title: "Review marks optional values (LinkedIn, Portfolio) as 'Missing' in the same amber as a value that would block approval", persona: "Maya", area: "Review / Open application data sheet", prd: "A1", expected: "Optional values say 'Not provided' or 'Optional'", actual: "LinkedIn profile: Missing; Portfolio or website: Missing; Approve still enabled", evidence: [evidence], suspectedFile: "apps/dashboard/src/components/DataSheetTable.tsx; apps/dashboard/src/i18n/en/common.json dataSheet.missing", wrong: "product" });
  check(facts["Retry (word)"].length === 0, { id: "D-retry-vs-try-again", severity: "P3", title: "'Retry' appears on screen while buttons say 'Try again'", persona: "Maya", area: facts["Retry (word)"].join(", "), prd: "Voice consistency", expected: "One word", actual: JSON.stringify(facts["Retry (word)"]), evidence: [evidence], wrong: "product" });
});
