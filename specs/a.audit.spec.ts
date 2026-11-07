// Section A: failure states (fake claude modes, runs that stop, the queue, empty and corrupt feeds, the server
// going away, a browser that goes offline, double clicks). For each failure: is the message plain and blame-free,
// is a next action offered, does it survive a reload, does the app recover.
// The fake claude is wrapped by makeFlakyClaude() so a mode can be switched on and OFF while the same server runs;
// every run is still a real run through the product's runner.
import fs from "node:fs";
import path from "node:path";
import { test, expect } from "./auditFixtures";
import { alertTexts, makeFlakyClaude, needsYouTexts, runCards, tempDir, removeDir } from "./helpers";
import { writeEvidence } from "./common";
import { auditPath } from "./paths";
import { check, finding, observation } from "./record";
import { sweep } from "./sweep";
import { DEMO_FEEDS_DIR } from "../support/server";
import { runningFakeClaudeProcesses } from "../support/processes";
import { waitUntilNoRunIsActive } from "../support/waits";
import { ACME, BRIGHTPATH, findJobsAndWaitForReview, needsYouItem } from "../support/flows";

const SEEDED = { seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } } as const;
const JARGON_IN_MESSAGE = /exit code|is_error|stack|undefined|null|\|\d{9}|error_|subtype|ENOENT|EPERM|mcp|stderr|json/i;

type Snapshot = Awaited<ReturnType<typeof snapshot>>;

async function snapshot(page: import("@playwright/test").Page) {
  return {
    cards: await runCards(page),
    needsYou: await needsYouTexts(page),
    alerts: await alertTexts(page),
    findJobsEnabled: await page.getByRole("button", { name: "Find jobs" }).isEnabled().catch(() => null),
  };
}

async function waitForRunToStop(page: import("@playwright/test").Page, timeout = 90_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const cards = await runCards(page);
        return cards.length > 0 && cards.every((card) => card.buttons.some((label) => /^Dismiss/.test(label)));
      },
      { timeout },
    )
    .toBe(true);
}

const MODES: { id: string; mode: string; kinds: Record<string, string>; label: string }[] = [
  { id: "usage-limit", mode: "usage-limit", kinds: { hunt: "usage-limit" }, label: "Claude plan limit reached" },
  { id: "signed-out", mode: "signed-out", kinds: { "*": "signed-out" }, label: "Claude signed out" },
  { id: "crash", mode: "crash", kinds: { hunt: "crash" }, label: "Claude process crashed" },
  { id: "max-turns", mode: "max-turns", kinds: { hunt: "max-turns" }, label: "Claude ran out of turns" },
  { id: "extra-tools", mode: "extra-tools", kinds: { hunt: "extra-tools" }, label: "Claude had a tool it must not have" },
];

for (const failure of MODES) {
  test(`A fake mode ${failure.id}: ${failure.label}`, async ({ page, startServer }) => {
    const flaky = makeFlakyClaude();
    try {
      const server = await startServer({ ...SEEDED, fakeClaudeEnv: flaky.env });
      await page.goto(server.url);
      await expect(page.getByRole("button", { name: "Find jobs" })).toBeEnabled();
      flaky.setModes(failure.kinds);
      await page.getByRole("button", { name: "Find jobs" }).click();
      await waitForRunToStop(page);
      const first = await snapshot(page);
      await page.screenshot({ path: auditPath("screens", "a", `${failure.id}-1-stopped.png`), fullPage: true });

      await page.reload();
      await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
      await expect(page.getByTestId("run-card").first()).toBeVisible();
      const afterReload = await snapshot(page);
      await page.screenshot({ path: auditPath("screens", "a", `${failure.id}-2-after-reload.png`), fullPage: true });

      // Recovery: the cause goes away, the person presses what the card offers.
      flaky.setModes(null);
      const tryAgain = page.getByTestId("run-card").first().getByRole("button", { name: /^Try again/ });
      const retryOffered = (await tryAgain.count()) > 0;
      let recovered = false;
      let afterRetry: Snapshot | null = null;
      if (retryOffered) {
        await tryAgain.click();
        await waitUntilNoRunIsActive(server, 120_000);
        await page.reload();
        afterRetry = await snapshot(page);
        recovered = afterRetry.needsYou.some((text) => /Ready to review/.test(text));
        await page.screenshot({ path: auditPath("screens", "a", `${failure.id}-3-after-retry.png`), fullPage: true });
      }
      const message = first.cards[0]?.status ?? "";
      const evidence = writeEvidence(`a-mode-${failure.id}.json`, {
        message,
        buttons: first.cards[0]?.buttons,
        needsYou: first.needsYou,
        alerts: first.alerts,
        afterReload,
        retryOffered,
        recovered,
        afterRetry,
        invocations: flaky.log(),
      });

      const jargon = JARGON_IN_MESSAGE.test([message, ...first.needsYou].join(" "));
      check(!jargon, {
        id: `A-${failure.id}-jargon`, severity: "P2", title: `Message for "${failure.id}" contains technical wording`, persona: "Maya", area: "Today / run card", prd: "Voice rules, R4",
        expected: "Plain words, no codes", actual: `${message} | ${first.needsYou.join(" | ")}`, evidence: [evidence], wrong: "product",
      });
      check(retryOffered || first.needsYou.some((text) => /Check settings|Update status|Answer|Review/.test(text)), {
        id: `A-${failure.id}-no-action`, severity: "P1", title: `No next action after "${failure.id}"`, persona: "Maya", area: "Today / run card", prd: "R4",
        expected: "A button to try again or a pointer to what to fix", actual: `buttons ${JSON.stringify(first.cards[0]?.buttons)} needsYou ${JSON.stringify(first.needsYou)}`, evidence: [evidence], wrong: "product",
      });
      check(!(first.needsYou.some((text) => /Check settings/.test(text)) && !/sign in|not installed|update/i.test(message)), {
        id: `A-${failure.id}-check-settings`, severity: "P2", title: `For "${failure.id}" the Needs you item says 'Check settings', which cannot fix it; Try again is only on the Running card further down`, persona: "Maya", area: "Today / Needs you (run attention)", prd: "R4 (next action)",
        expected: "A button that matches the cause (Try again, or 'See when it resets')", actual: `${message} -> ${first.needsYou.join(" | ")}`, evidence: [evidence],
        suspectedFile: "apps/dashboard/src/components/NeedsYouList.tsx:17-23 (every run-attention item links to /settings); apps/dashboard/src/i18n/en/today.json:46", wrong: "product",
      });
      check(afterReload.cards[0]?.status === message, {
        id: `A-${failure.id}-reload`, severity: "P2", title: `State for "${failure.id}" does not survive a reload`, persona: "Maya", area: "Today", prd: "R4",
        expected: "Same message after reload", actual: `before "${message}" after "${afterReload.cards[0]?.status}"`, evidence: [evidence], wrong: "product",
      });
      check(recovered, {
        id: `A-${failure.id}-recover`, severity: "P1", title: `Cannot recover from "${failure.id}" by pressing Try again once the cause is gone`, persona: "Maya", area: "Today", prd: "R4",
        expected: "Try again finishes the work", actual: `retry offered ${retryOffered}; needs you after: ${JSON.stringify(afterRetry?.needsYou)}`, evidence: [evidence], wrong: "product",
      });
    } finally {
      flaky.remove();
    }
  });
}

// A usage limit in the middle of the queue: the hunt finds jobs, the tailoring that follows hits the limit.
test("A queue: plan limit hits the tailoring run after a good hunt; a second Find jobs; then Try again", async ({ page, startServer }) => {
  const flaky = makeFlakyClaude();
  try {
    const server = await startServer({ ...SEEDED, fakeClaudeEnv: flaky.env });
    await page.goto(server.url);
    flaky.setModes({ tailor: "usage-limit" });
    await page.getByRole("button", { name: "Find jobs" }).click();
    await expect.poll(async () => (await runCards(page)).some((card) => /Tailoring/.test(card.title) && /limit/.test(card.status)), { timeout: 90_000 }).toBe(true);
    const blocked = await snapshot(page);
    await page.screenshot({ path: auditPath("screens", "a", "queue-1-tailor-blocked.png"), fullPage: true });
    const pipelineWhileBlocked = await server.api<{ company: string; title: string; status: string }[]>("/api/pipeline");

    // The person presses Find jobs again while the tailor run is blocked.
    const findEnabled = await page.getByRole("button", { name: "Find jobs" }).isEnabled();
    let secondHuntWaitedText = "";
    if (findEnabled) {
      await page.getByRole("button", { name: "Find jobs" }).click();
      await page.waitForTimeout(6_000); // watching the card for a few seconds, as a person would
      const cards = await runCards(page);
      secondHuntWaitedText = JSON.stringify(cards);
      await page.screenshot({ path: auditPath("screens", "a", "queue-2-second-find-jobs.png"), fullPage: true });
    }
    const huntCardsWhileBlocked = (await runCards(page)).filter((card) => /Finding jobs/.test(card.title));
    const secondHuntStuck = huntCardsWhileBlocked.some((card) => /Waiting for its turn|Getting started/.test(card.status));

    flaky.setModes(null);
    await page.getByTestId("run-card").filter({ hasText: "Tailoring resumes" }).getByRole("button", { name: /^Try again/ }).click();
    await waitUntilNoRunIsActive(server, 150_000).catch(() => undefined);
    await page.reload();
    const after = await snapshot(page);
    await page.screenshot({ path: auditPath("screens", "a", "queue-3-after-try-again.png"), fullPage: true });
    const evidence = writeEvidence("a-queue-usage-limit.json", { blocked, pipelineWhileBlocked, findEnabled, secondHuntWaitedText, secondHuntStuck, after, invocations: flaky.log() });

    check(!secondHuntStuck, {
      id: "A-queue-stuck", severity: "P2", title: "While a run is blocked by the plan limit, a second Find jobs sits in 'Waiting for its turn' with no explanation", persona: "Maya", area: "Today / queue", prd: "R4, R1",
      expected: "Find jobs is unavailable with a reason, or the card says the queue is paused because of the limit", actual: `Find jobs enabled while blocked: ${findEnabled}; hunt cards: ${JSON.stringify(huntCardsWhileBlocked)}`,
      evidence: [evidence, auditPath("screens", "a", "queue-2-second-find-jobs.png")], suspectedFile: "packages/server/src/runner/launcher.ts:57-75 (isPaused cleared only by a retry of the blocked run); apps/dashboard/src/screens/TodayScreen.tsx:55 (only hunt runs disable Find jobs)", wrong: "product",
    });
    check(after.needsYou.some((text) => /Ready to review/.test(text)), {
      id: "A-queue-recover", severity: "P1", title: "Try again on the blocked tailoring run does not bring the applications to Ready to review", persona: "Maya", area: "Today / queue", prd: "R4",
      expected: "The queue resumes", actual: JSON.stringify(after.needsYou), evidence: [evidence], wrong: "product",
    });
  } finally {
    flaky.remove();
  }
});

// Cancel during tailoring, a reload during a run, and Find jobs while a run is active.
test("A runs: reload during a run, cancel during tailoring, Find jobs while active", async ({ page, startServer }) => {
  const flaky = makeFlakyClaude();
  try {
    const server = await startServer({ ...SEEDED, fakeClaudeEnv: flaky.env });
    await page.goto(server.url);
    flaky.setModes({ tailor: "slow" });
    await page.getByRole("button", { name: "Find jobs" }).click();
    const tailorCard = page.getByTestId("run-card").filter({ hasText: "Tailoring resumes" });
    await expect(tailorCard).toBeVisible({ timeout: 90_000 });
    const duringRun = await snapshot(page);
    const findDisabledDuringTailor = !(await page.getByRole("button", { name: "Find jobs" }).isEnabled());

    await page.reload();
    await expect(page.getByTestId("run-card").filter({ hasText: "Tailoring resumes" })).toBeVisible();
    const afterReload = await snapshot(page);

    await page.getByTestId("run-card").filter({ hasText: "Tailoring resumes" }).getByRole("button", { name: /^Cancel/ }).click();
    await expect(page.getByTestId("run-card").filter({ hasText: "Tailoring resumes" }).getByRole("status")).toContainText(/cancel/i);
    const afterCancel = await snapshot(page);
    const pipelineAfterCancel = await server.api<{ company: string; title: string; status: string }[]>("/api/pipeline");
    await page.screenshot({ path: auditPath("screens", "a", "runs-cancel-tailoring.png"), fullPage: true });
    await expect.poll(() => runningFakeClaudeProcesses(), { timeout: 20_000 }).toEqual([]);

    // What can the person do with the applications whose resume was never made?
    const stuck = pipelineAfterCancel.filter((row) => /Found|Scored/.test(row.status) && /apply|stretch/.test(String((row as { band?: string }).band)));
    const needsAfterCancel = afterCancel.needsYou;
    const acmeRow = pipelineAfterCancel.find((row) => row.company === "Acme Cloud");
    let acmePage: { buttons: string[]; text: string } | null = null;
    if (acmeRow !== undefined) {
      await page.goto(`${server.origin}/apps/${(acmeRow as { id: string }).id}`);
      await expect(page.getByRole("heading", { level: 1, name: "Backend Engineer" })).toBeVisible();
      acmePage = { buttons: await page.getByRole("button").allInnerTexts(), text: (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 700) };
      await page.screenshot({ path: auditPath("screens", "a", "runs-cancel-acme-application-page.png"), fullPage: true });
    }
    const evidence = writeEvidence("a-runs-cancel-reload.json", { duringRun, findDisabledDuringTailor, afterReload, afterCancel, pipelineAfterCancel, stuck, acmePage });
    check(afterReload.cards.some((card) => /Tailoring/.test(card.title)), {
      id: "A-reload-during-run", severity: "P2", title: "A reload during a run loses the run card", persona: "Maya", area: "Today", prd: "R1",
      expected: "The card is still there", actual: JSON.stringify(afterReload.cards), evidence: [evidence], wrong: "product",
    });
    const acmeOnToday = needsAfterCancel.some((text) => /Acme Cloud/.test(text));
    const cardOffersRetry = afterCancel.cards.some((card) => /Tailoring/.test(card.title) && card.buttons.some((label) => /^Try again/.test(label)));
    const acmeCanTailor = (acmePage?.buttons ?? []).some((label) => /Tailor/i.test(label));
    check(stuck.length === 0 || acmeOnToday || cardOffersRetry, {
      id: "A-cancel-tailor-no-way-back", severity: "P2", title: "After Cancel on a tailoring run, the strong matches that had no resume yet vanish from Today and the cancelled card has no Try again; the only way back is Pipeline, the application page, Tailor a resume (one job at a time)", persona: "Maya", area: "Today / run card / Application", prd: "R4, T1, 'nothing is lost'",
      expected: "Try again on the cancelled card, or the jobs listed on Today as 'Not tailored' with a button", actual: `no-resume strong rows ${stuck.map((row) => row.company).join(", ")}; on Today: ${JSON.stringify(needsAfterCancel)}; card buttons ${JSON.stringify(afterCancel.cards.map((card) => card.buttons))}; Acme application page buttons (does offer a way): ${JSON.stringify(acmePage?.buttons)}; acmeCanTailor=${acmeCanTailor}`,
      evidence: [evidence, auditPath("screens", "a", "runs-cancel-tailoring.png")], suspectedFile: "apps/dashboard/src/components/RunCard.tsx:11 (RETRYABLE_STATUSES omits cancelled while services/runLifecycle.ts:14 allows it); services/today.ts (no 'not-tailored' item for Scored apply/stretch)", wrong: "product",
    });
  } finally {
    flaky.remove();
  }
});

test("A double clicks: Find jobs twice quickly, Approve twice, I submitted twice, Restore twice", async ({ page, startServer }) => {
  const server = await startServer(SEEDED);
  await page.goto(server.url);
  const results: Record<string, unknown> = {};

  await page.getByRole("button", { name: "Find jobs" }).dblclick();
  await waitUntilNoRunIsActive(server, 120_000);
  await page.reload();
  const hunts = (await runCards(page)).filter((card) => /Finding jobs/.test(card.title));
  results.huntCardsAfterDoubleClick = hunts.length;
  check(hunts.length === 1, {
    id: "A-dbl-find", severity: "P2", title: "Double-clicking Find jobs starts two hunts", persona: "Both", area: "Today", prd: "R1",
    expected: "One run", actual: `${hunts.length} hunt cards`, evidence: [auditPath("a-double-clicks.json")], wrong: "product",
  });

  await expect(needsYouItem(page, ACME)).toContainText("Ready to review");
  await needsYouItem(page, ACME).getByRole("link", { name: "Review" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Backend Engineer" })).toBeVisible();
  const url = page.url();
  const acmeId = new URL(url).pathname.split("/").pop() ?? "";
  await page.getByRole("button", { name: "Approve" }).dblclick();
  await page.waitForTimeout(2500);
  results.afterDoubleApprove = { url: page.url(), alerts: await alertTexts(page), serverOutputTail: server.output().split("\n").filter((line) => line.trim() !== "" && !/NO_COLOR|trace-warnings/.test(line)).slice(-12) };
  await page.screenshot({ path: auditPath("screens", "a", "double-approve-result.png"), fullPage: true });
  const detail = await server.api<{ application: { status: string } }>(`/api/apps/${acmeId}`);
  results.acmeStatus = detail.application.status;
  const history = await server.api<{ history?: { type: string }[] }>(`/api/apps/${acmeId}`);
  results.approvedEvents = (history.history ?? []).filter((event) => /approved/.test(event.type)).length;
  check((results.afterDoubleApprove as { alerts: string[] }).alerts.length === 0, {
    id: "A-dbl-approve", severity: "P2", title: "Double-clicking Approve shows an error to the person", persona: "Both", area: "Review", prd: "A2",
    expected: "No error; one approval", actual: JSON.stringify(results.afterDoubleApprove), evidence: [auditPath("a-double-clicks.json")], wrong: "product",
  });

  await waitUntilNoRunIsActive(server, 120_000);
  await page.goto(`${server.origin}/apply/${acmeId}`);
  await page.getByRole("button", { name: "I submitted" }).click();
  const dialog = page.getByRole("dialog", { name: "Record that you applied" });
  await dialog.getByLabel("I saw the confirmation, and have nothing to paste").check();
  await dialog.getByRole("button", { name: "Record as applied" }).dblclick();
  await page.waitForTimeout(2500);
  const submitted = await server.api<{ application: { status: string } }>(`/api/apps/${acmeId}`);
  results.afterDoubleSubmitted = { status: submitted.application.status, url: page.url(), alerts: await alertTexts(page) };

  await page.goto(`${server.origin}/settings`);
  const backups = page.getByRole("region", { name: "Backups" });
  await backups.getByRole("button", { name: "Back up now" }).click();
  await expect(backups.getByRole("button", { name: /^Restore the backup from / }).first()).toBeVisible();
  await backups.getByRole("button", { name: /^Restore the backup from / }).first().click();
  const restore = page.getByRole("dialog", { name: "Restore this backup?" });
  await restore.getByRole("button", { name: "Restore" }).dblclick().catch(() => undefined);
  await page.waitForTimeout(3000);
  results.afterDoubleRestore = { url: page.url(), alerts: await alertTexts(page), dialogOpen: await page.getByRole("dialog").count() };
  writeEvidence("a-double-clicks.json", results);
  check((results.afterDoubleSubmitted as { alerts: string[] }).alerts.length === 0 && (results.afterDoubleSubmitted as { status: string }).status === "Applied", {
    id: "A-dbl-submitted", severity: "P2", title: "Double-clicking the I submitted confirm button errors or does not end at Applied", persona: "Both", area: "Open application", prd: "U4",
    expected: "One submission, Applied", actual: JSON.stringify(results.afterDoubleSubmitted), evidence: [auditPath("a-double-clicks.json")], wrong: "unclear",
  });
  check((results.afterDoubleRestore as { alerts: string[] }).alerts.length === 0, {
    id: "A-dbl-restore", severity: "P2", title: "Double-clicking Restore shows an error", persona: "Both", area: "Settings", prd: "S5",
    expected: "No error", actual: JSON.stringify(results.afterDoubleRestore), evidence: [auditPath("a-double-clicks.json")], wrong: "unclear",
  });
});

// An empty feed folder, a folder with no companies, and a board file that is not valid.
test("A feeds: empty folder, zero companies, corrupt board", async ({ page, startServer }) => {
  const results: Record<string, unknown> = {};
  const folders: string[] = [];
  try {
    const empty = tempDir("feed-empty");
    folders.push(empty);
    const noCompanies = tempDir("feed-nocompanies");
    folders.push(noCompanies);
    fs.writeFileSync(path.join(noCompanies, "companies.json"), "[]");
    const corrupt = tempDir("feed-corrupt");
    folders.push(corrupt);
    fs.cpSync(DEMO_FEEDS_DIR, corrupt, { recursive: true });
    fs.writeFileSync(path.join(corrupt, "greenhouse", "acmecloud.json"), "{ this is not json");
    const allCorrupt = tempDir("feed-allcorrupt");
    folders.push(allCorrupt);
    fs.cpSync(DEMO_FEEDS_DIR, allCorrupt, { recursive: true });
    for (const file of ["greenhouse/acmecloud.json", "lever/brightpath.json", "ashby/copperleaf.json"]) fs.writeFileSync(path.join(allCorrupt, file), "<html>Service Unavailable</html>");

    for (const variant of [
      { id: "empty-folder", dir: empty },
      { id: "zero-companies", dir: noCompanies },
      { id: "one-corrupt-board", dir: corrupt },
      { id: "all-boards-corrupt", dir: allCorrupt },
    ]) {
      let server: Awaited<ReturnType<typeof startServer>>;
      try {
        server = await startServer({ ...SEEDED, fakeClaudeEnv: { JOBGOBLIN_FEED_FIXTURES: variant.dir } });
      } catch (error) {
        // The server itself refused to start with this folder: that is the result for this variant.
        results[variant.id] = { serverStarted: false, error: String(error).slice(0, 500) };
        continue;
      }
      await page.goto(server.url);
      await page.getByRole("button", { name: "Find jobs" }).click();
      await page.waitForTimeout(1500);
      await expect.poll(async () => (await server.api<{ running: { status: string }[] }>("/api/today")).running.every((run) => run.status !== "queued" && run.status !== "running"), { timeout: 90_000 }).toBe(true);
      await page.reload();
      await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
      const view = await snapshot(page);
      const body = await page.locator("main").innerText();
      await page.screenshot({ path: auditPath("screens", "a", `feed-${variant.id}.png`), fullPage: true });
      results[variant.id] = { ...view, body: body.replace(/\s+/g, " ").slice(0, 600), serverLog: server.output().split("\n").filter((line) => /board|feed|could not|error|warn/i.test(line)).slice(0, 6) };
      await server.stop();
    }
    const evidence = writeEvidence("a-feeds.json", results);
    const emptyView = results["empty-folder"] as { serverStarted?: boolean; error?: string };
    check(emptyView.serverStarted !== false, {
      id: "A-feed-empty-folder", severity: "P3", title: "A demo feed folder without companies.json makes the whole server exit at start-up with a raw ENOENT (dev/demo configuration only)", persona: "Alex", area: "Server start (JOBGOBLIN_FEED_FIXTURES)", prd: "R4",
      expected: "A readable message naming the folder and the missing file, or an empty result", actual: String(emptyView.error ?? "").slice(0, 300), evidence: [evidence], suspectedFile: "packages/server/src/services/feeds.ts:130-136 (readSeedCompanies, unguarded readFileSync)", wrong: "product",
    });
    const zero = results["zero-companies"] as Snapshot & { body: string };
    check(/found|new|no jobs|nothing/i.test(zero.body) && !/Nothing needs you right now\.\s*Done today/.test(zero.body.replace(/\n/g, " ")), {
      id: "A-feed-zero", severity: "P2", title: "When no jobs are found, Today does not say so", persona: "Maya", area: "Today (empty result)", prd: "D3",
      expected: "Today says nothing new was found and what to do (check targets, try later)", actual: zero.body, evidence: [evidence], wrong: "product",
    });
    const all = results["all-boards-corrupt"] as Snapshot & { body: string };
    check(/could not|unavailable|try again|boards/i.test(all.body), {
      id: "A-feed-failures-silent", severity: "P2", title: "When job boards cannot be read, Find jobs ends 'Finished' with a smaller count and never mentions that boards failed", persona: "Maya", area: "Today (Find jobs result)", prd: "D1, R4",
      expected: "Today says some boards could not be read and that results may be incomplete", actual: all.body, evidence: [evidence],
      suspectedFile: "packages/server/src/services/feeds.ts:49,108-110 (failures are only logged); RefreshFeedsReport.failures is not shown", wrong: "product",
    });
  } finally {
    for (const folder of folders) removeDir(folder);
  }
});

// The server goes away while the dashboard is open; the browser goes offline and comes back.
test("A connection: server dies with the dashboard open; browser offline then online", async ({ page, context, startServer }) => {
  const server = await startServer(SEEDED);
  await page.goto(server.url);
  await expect(page.getByRole("button", { name: "Find jobs" })).toBeEnabled();
  const results: Record<string, unknown> = {};

  // Offline first (the server is healthy).
  // (A real wifi drop does not stop 127.0.0.1; Chromium's offline emulation does, so this is a worst case.)
  await context.setOffline(true);
  await page.getByRole("button", { name: "Find jobs" }).click();
  const timeline: unknown[] = [];
  for (const wait of [500, 2000, 5000, 10_000]) {
    await page.waitForTimeout(wait);
    timeline.push({ afterMs: wait, alerts: await alertTexts(page), findEnabled: await page.getByRole("button", { name: "Find jobs" }).isEnabled() });
  }
  results.offlineTimeline = timeline;
  results.offlineAlert = await alertTexts(page);
  await page.screenshot({ path: auditPath("screens", "a", "conn-offline.png"), fullPage: true });
  await context.setOffline(false);
  await page.waitForTimeout(1500);
  results.afterOnlineFindEnabled = await page.getByRole("button", { name: "Find jobs" }).isEnabled();
  if (!(results.afterOnlineFindEnabled as boolean)) await page.reload();
  await page.getByRole("button", { name: "Find jobs" }).click();
  await waitUntilNoRunIsActive(server, 120_000);
  await page.waitForTimeout(1000);
  results.afterBackOnlineAlerts = await alertTexts(page);
  results.afterBackOnlineNeeds = await needsYouTexts(page);
  const liveUpdateWorked = (await needsYouTexts(page)).some((text) => /Ready to review/.test(text));
  results.liveUpdateWorkedWithoutReload = liveUpdateWorked;

  // The server dies. Nothing is clicked for a while: does the screen say anything?
  await server.crash();
  await page.waitForTimeout(8000);
  results.afterCrashUnclicked = { alerts: await alertTexts(page), text: (await page.locator("body").innerText()).slice(0, 400) };
  await page.screenshot({ path: auditPath("screens", "a", "conn-server-dead-idle.png"), fullPage: true });
  const findAfterCrash = page.getByRole("button", { name: "Find jobs" });
  results.findJobsStillEnabledWhenServerIsDead = await findAfterCrash.isEnabled().catch(() => false);
  if (results.findJobsStillEnabledWhenServerIsDead) await findAfterCrash.click();
  await page.waitForTimeout(2500);
  results.afterCrashFindJobs = { alerts: await alertTexts(page) };
  await page.screenshot({ path: auditPath("screens", "a", "conn-server-dead-find.png"), fullPage: true });
  await page.getByRole("link", { name: "Pipeline" }).click();
  await page.waitForTimeout(2500);
  results.afterCrashPipelineClick = {
    headings: await page.getByRole("heading").allInnerTexts(),
    alerts: await alertTexts(page),
    text: (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300),
    sidebarStillThere: (await page.getByRole("navigation", { name: "Main" }).count()) > 0,
  };
  await page.screenshot({ path: auditPath("screens", "a", "conn-server-dead-navigate.png"), fullPage: true });
  const tryAgain = page.getByRole("button", { name: "Try again" });
  if ((await tryAgain.count()) > 0) {
    await tryAgain.first().click();
    await page.waitForTimeout(2000);
    results.afterTryAgainOnDeadServer = { headings: await page.getByRole("heading").allInnerTexts(), text: (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300) };
    await page.screenshot({ path: auditPath("screens", "a", "conn-server-dead-try-again.png"), fullPage: true });
  }
  const evidence = writeEvidence("a-connection.json", results);

  const offlineText = (results.offlineAlert as string[]).join(" ");
  check(/could not be reached/i.test(offlineText) && /try again|still open/i.test(offlineText), {
    id: "A-offline-message", severity: "P3", title: "Offline message is not plain or has no next step", persona: "Maya", area: "Today", prd: "R4",
    expected: "'could not be reached' + what to do", actual: offlineText, evidence: [evidence], wrong: "product",
  });
  check(liveUpdateWorked, {
    id: "A-offline-recover", severity: "P2", title: "After the browser comes back online, the screen does not catch up by itself", persona: "Maya", area: "Today (live updates)", prd: "R1",
    expected: "Needs you shows the finished work", actual: JSON.stringify(results.afterBackOnlineNeeds), evidence: [evidence], suspectedFile: "apps/dashboard/src/api/liveUpdates.ts", wrong: "unclear",
  });
  const idleText = JSON.stringify(results.afterCrashUnclicked);
  check(/could not be reached|restart|reconnect|not running|offline/i.test(idleText), {
    id: "A-server-dead-silent", severity: "P2", title: "When Jobgoblin stops while a screen is open, the screen shows nothing until the person clicks something", persona: "Maya", area: "AppShell / live updates", prd: "R4",
    expected: "A visible 'Jobgoblin is not running' banner with what to do", actual: idleText, evidence: [evidence, auditPath("screens", "a", "conn-server-dead-idle.png")], suspectedFile: "apps/dashboard/src/api/liveUpdates.ts; apps/dashboard/src/components/AppShell.tsx", wrong: "product",
  });
  const deadEnd = results.afterCrashPipelineClick as { sidebarStillThere: boolean; text: string };
  check(deadEnd.sidebarStillThere && /could not be reached|not running|open again/i.test(deadEnd.text), {
    id: "A-server-dead-navigate", severity: "P2", title: "After Jobgoblin stops, opening another screen shows 'Something went wrong on this screen' with no navigation and no hint that Jobgoblin is not running", persona: "Maya", area: "Route error screen", prd: "R4 ('errors say what happened and what to do')",
    expected: "The 'Jobgoblin could not be reached. Check that Jobgoblin is still open' message and the sidebar", actual: JSON.stringify(deadEnd), evidence: [evidence, auditPath("screens", "a", "conn-server-dead-navigate.png")],
    suspectedFile: "apps/dashboard/src/components/RouteErrorScreen.tsx (shows the generic message for a failed lazy screen load)", wrong: "product",
  });
  observation("connection", { note: "see a-connection.json" });
  void finding;
  void sweep;
  void BRIGHTPATH;
  void findJobsAndWaitForReview;
});
