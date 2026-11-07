// Section A, part 2: Claude Code not installed, too old, and the Install button with a stub that succeeds and one that
// fails. SAFETY: the real claude.exe lives in ~/.local/bin, so for these servers PATH, USERPROFILE, HOME and
// LOCALAPPDATA point at empty temp folders, JOBGOBLIN_CLAUDE_COMMAND is empty (so the server searches) and
// JOBGOBLIN_CLAUDE_INSTALL_COMMAND is always a stub of ours (the default is a real winget install). Before any click
// each test asks the server for its Claude status and stops if it is not the state the test needs.
// Sign in is NEVER clicked here.
import fs from "node:fs";
import { test, expect } from "./auditFixtures";
import { alertTexts, makeFlakyClaude, makeInstallStub, needsYouTexts, removeDir, runCards, tempDir, withNoClaudeOnThisMachine } from "./helpers";
import { writeEvidence } from "./common";
import { auditPath } from "./paths";
import { check } from "./record";

type ClaudeStatus = { state: string; version: string | null; installCommand: string };
const SEEDED = { seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } } as const;

async function claudeState(server: { api: <T>(route: string) => Promise<T> }): Promise<ClaudeStatus> {
  return server.api<ClaudeStatus>("/api/claude/status");
}

test("A not installed: Settings, wizard and Find jobs say so; Install fails silently?; Install succeeds", async ({ page, startServer }) => {
  const home = tempDir("home");
  const failing = makeInstallStub("fail", home);
  const results: Record<string, unknown> = {};
  try {
    const server = await withNoClaudeOnThisMachine(home, () =>
      startServer({ ...SEEDED, fakeClaudeEnv: { JOBGOBLIN_CLAUDE_COMMAND: "", ...failing.env } }),
    );
    // SAFETY GATE: confirm the not-installed state before any click.
    const status = await claudeState(server);
    results.statusBeforeAnyClick = status;
    expect(status.state, "the server must not be able to find any claude.exe").toBe("not-installed");
    expect(status.installCommand, "the install command shown must be our stub, not winget").not.toMatch(/winget/i);

    // Today and Find jobs.
    await page.goto(server.url);
    await expect(page.getByRole("button", { name: "Find jobs" })).toBeEnabled();
    await page.getByRole("button", { name: "Find jobs" }).click();
    await expect.poll(async () => (await runCards(page)).some((card) => card.buttons.some((label) => /^Dismiss/.test(label))), { timeout: 60_000 }).toBe(true);
    results.todayAfterFindJobs = { cards: await runCards(page), needsYou: await needsYouTexts(page), alerts: await alertTexts(page) };
    await page.screenshot({ path: auditPath("screens", "a", "noclaude-1-today-find-jobs.png"), fullPage: true });

    // The attention item on Today: where does its action go?
    const attention = page.getByTestId("needs-you-item").filter({ hasText: "Needs attention" });
    if ((await attention.count()) > 0) {
      const link = attention.getByRole("link").first();
      results.attentionAction = { text: await link.innerText(), href: await link.getAttribute("href") };
      await link.click();
      await page.waitForTimeout(800);
      results.attentionLandedOn = page.url();
      await page.screenshot({ path: auditPath("screens", "a", "noclaude-2-attention-action-lands.png"), fullPage: true });
    }

    // Settings: the connection card.
    await page.goto(`${server.origin}/settings`);
    const connection = page.getByRole("region", { name: "Claude connection" });
    await expect(connection).toContainText("Not installed");
    results.settingsText = (await connection.innerText()).replace(/\s+/g, " ");
    await page.screenshot({ path: auditPath("screens", "a", "noclaude-3-settings.png"), fullPage: true });

    // Install with the FAILING stub.
    await connection.getByRole("button", { name: "Install Claude Code" }).click();
    await expect.poll(() => failing.calls().length, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    results.afterFailedInstall = { text: (await connection.innerText()).replace(/\s+/g, " "), alerts: await alertTexts(page), stubCalls: failing.calls(), stateNow: (await claudeState(server)).state };
    await page.screenshot({ path: auditPath("screens", "a", "noclaude-4-after-failed-install.png"), fullPage: true });

    // The wizard's Connect step, and whether the person can carry on without Claude.
    await page.goto(`${server.origin}/setup/2`);
    await expect(page.getByRole("heading", { level: 1, name: "Connect Claude" })).toBeVisible();
    const continueButton = page.getByRole("button", { name: "Continue" });
    results.wizardConnect = { text: (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 600), continueEnabled: await continueButton.isEnabled().catch(() => null) };
    await page.screenshot({ path: auditPath("screens", "a", "noclaude-5-wizard-connect.png"), fullPage: true });
    const evidence = writeEvidence("a-claude-not-installed.json", results);

    const afterFail = results.afterFailedInstall as { alerts: string[]; text: string };
    check(afterFail.alerts.length > 0 || /could not|did not work|failed|try again|didn't/i.test(afterFail.text.replace(/Check again/g, "")), {
      id: "A-install-failure-silent", severity: "P1", title: "When Install fails, nothing tells the person it failed; the card just returns to 'Not installed'", persona: "Maya", area: "Settings / Connect Claude", prd: "S2, 'errors say what happened and what to do'",
      expected: "A plain message that the install did not work and what to do (install by hand, try again)", actual: JSON.stringify(results.afterFailedInstall), evidence: [evidence, auditPath("screens", "a", "noclaude-4-after-failed-install.png")],
      suspectedFile: "packages/server/src/runner/claudeCli.ts:102-105 (install ignores the command's result); apps/dashboard/src/components/ClaudeConnection.tsx:74", wrong: "product",
    });
    const today = results.todayAfterFindJobs as { cards: { status: string }[]; needsYou: string[] };
    check(/not installed/i.test(JSON.stringify(today.cards)), {
      id: "A-not-installed-card", severity: "P2", title: "Find jobs without Claude Code does not say Claude Code is not installed", persona: "Maya", area: "Today", prd: "S2, R4",
      expected: "'Claude Code is not installed' with a pointer to Settings", actual: JSON.stringify(today), evidence: [evidence], wrong: "product",
    });
  } finally {
    failing.remove();
    removeDir(home);
  }
});

test("A install success: the stub installs a program; the card moves on to the next state", async ({ page, startServer }) => {
  const home = tempDir("home");
  const ok = makeInstallStub("ok", home);
  const results: Record<string, unknown> = {};
  try {
    const server = await withNoClaudeOnThisMachine(home, () => startServer({ ...SEEDED, fakeClaudeEnv: { JOBGOBLIN_CLAUDE_COMMAND: "", ...ok.env } }));
    const status = await claudeState(server);
    expect(status.state, "the server must not be able to find any claude.exe").toBe("not-installed");
    expect(status.installCommand).not.toMatch(/winget/i);
    await page.goto(`${server.origin}/settings#token=${server.token}`);
    const connection = page.getByRole("region", { name: "Claude connection" });
    await expect(connection).toContainText("Not installed");
    await connection.getByRole("button", { name: "Install Claude Code" }).click();
    await expect(connection).not.toContainText("Not installed", { timeout: 30_000 });
    results.afterInstall = { text: (await connection.innerText()).replace(/\s+/g, " "), state: (await claudeState(server)).state, stubCalls: ok.calls() };
    await page.screenshot({ path: auditPath("screens", "a", "noclaude-6-after-successful-install.png"), fullPage: true });
    writeEvidence("a-claude-install-success.json", results);
    // NOTE: the stub copies node.exe as claude.exe, so the state after install is "Not signed in". Sign in is not clicked.
  } finally {
    ok.remove();
    removeDir(home);
  }
});

test("A too old: Claude Code 1.0.0 shows 'Needs an update'; Update with a failing stub", async ({ page, startServer }) => {
  const home = tempDir("home");
  const flaky = makeFlakyClaude();
  const failing = makeInstallStub("fail", home);
  const results: Record<string, unknown> = {};
  try {
    const server = await startServer({ ...SEEDED, fakeClaudeEnv: { ...flaky.env, ...failing.env } });
    flaky.setModes({ version: "1.0.0" });
    const status = await claudeState(server);
    expect(status.state, "the fake must report an old version").toBe("update-needed");
    expect(status.installCommand).not.toMatch(/winget/i);
    await page.goto(`${server.origin}/settings#token=${server.token}`);
    const connection = page.getByRole("region", { name: "Claude connection" });
    await expect(connection).toContainText("Needs an update");
    results.settingsText = (await connection.innerText()).replace(/\s+/g, " ");
    await page.screenshot({ path: auditPath("screens", "a", "tooold-1-settings.png"), fullPage: true });
    await page.goto(`${server.origin}/today`);
    await page.getByRole("button", { name: "Find jobs" }).click();
    await expect.poll(async () => (await runCards(page)).some((card) => card.buttons.some((label) => /^Dismiss/.test(label))), { timeout: 60_000 }).toBe(true);
    results.todayAfterFindJobs = { cards: await runCards(page), needsYou: await needsYouTexts(page) };
    await page.screenshot({ path: auditPath("screens", "a", "tooold-2-today.png"), fullPage: true });
    await page.goto(`${server.origin}/settings`);
    await page.getByRole("region", { name: "Claude connection" }).getByRole("button", { name: "Update Claude Code" }).click();
    await expect.poll(() => failing.calls().length, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1500);
    results.afterFailedUpdate = { text: (await page.getByRole("region", { name: "Claude connection" }).innerText()).replace(/\s+/g, " "), alerts: await alertTexts(page) };
    const evidence = writeEvidence("a-claude-too-old.json", results);
    const today = results.todayAfterFindJobs as { cards: { status: string }[] };
    check(/update/i.test(JSON.stringify(today.cards)), {
      id: "A-too-old-card", severity: "P2", title: "Find jobs with an old Claude Code does not say it needs an update", persona: "Maya", area: "Today", prd: "S2",
      expected: "'Claude Code needs an update'", actual: JSON.stringify(today), evidence: [evidence], wrong: "product",
    });
    void fs;
  } finally {
    flaky.remove();
    failing.remove();
    removeDir(home);
  }
});
