// J2: day 2. The app is restarted on the same data (new port, new token). What does an old browser tab do, what does a
// second Find jobs say when nothing is new, does Today still make sense, and does an overdue follow-up show up?
import { test, expect } from "./auditFixtures";
import { writeEvidence, localDayPlus } from "./common";
import { auditPath } from "./paths";
import { finding } from "./record";
import { ACME, BRIGHTPATH, COPPERLEAF, findJobsAndWaitForReview, needsYouItem } from "../support/flows";
import { approveAndMarkApplied, findApplicationId } from "../support/seed";
import { startRecordingRunCards, recordedRunCardTexts } from "../support/pageProbes";
import { waitUntilNoRunIsActive } from "../support/waits";

test("J2: restart on the same data, then Find jobs again", async ({ page, context, startServer, audit }) => {
  audit.expectNoise(/ERR_CONNECTION_REFUSED|Failed to fetch|api\/events|net::ERR/);
  const first = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
  await startRecordingRunCards(page);
  await page.goto(first.url);
  await findJobsAndWaitForReview(page);
  const acmeId = await findApplicationId(first, "Acme Cloud", "Backend Engineer");
  await approveAndMarkApplied(first, acmeId);
  await waitUntilNoRunIsActive(first);
  // An overdue follow-up: the person recorded Phone screen with a follow-up date that has passed.
  await first.api(`/api/apps/${acmeId}/status`, { body: { to: "Phone screen", followUpOn: localDayPlus(-2), note: "" } });
  const todayBefore = await first.api<{ needsYou: { kind: string; title: string }[] }>("/api/today");
  writeEvidence("j2-today-before-restart.json", todayBefore);
  await page.goto(`${first.origin}/today`);
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();

  // ---- the restart: kill the server, start a new one on the same data
  await first.killHard();
  const second = await startServer({ reuseDataOf: first });
  writeEvidence("j2-restart.json", { oldOrigin: first.origin, newOrigin: second.origin, portChanged: first.origin !== second.origin, tokenChanged: first.token !== second.token });

  await test.step("the old tab: what does the person see, and can she get back without help?", async () => {
    await page.waitForTimeout(3000); // the old tab's event stream notices the server went away
    await page.screenshot({ path: auditPath("screens", "j2", "01-old-tab-after-restart.png"), fullPage: true });
    const idleText = await page.locator("body").innerText();
    // She presses Find jobs on the old tab, as she would.
    const find = page.getByRole("button", { name: "Find jobs" });
    if (await find.isVisible()) await find.click();
    await page.waitForTimeout(2000);
    const afterClickText = await page.locator("body").innerText();
    await page.screenshot({ path: auditPath("screens", "j2", "02-old-tab-after-find-click.png"), fullPage: true });
    // Reloading the old address: the server is not there at all. The browser, not Jobgoblin, answers.
    let afterReloadText = "";
    try {
      await page.reload();
      await page.waitForTimeout(1500);
      afterReloadText = await page.locator("body").innerText();
    } catch (error) {
      afterReloadText = `RELOAD FAILED IN THE BROWSER: ${(error as Error).message.split("\n")[0]}`;
    }
    await page.screenshot({ path: auditPath("screens", "j2", "03-old-tab-after-reload.png"), fullPage: true });
    writeEvidence("j2-old-tab-text.json", { idleText, afterClickText, afterReloadText });

    const tellsHer = /could not be reached|not reachable|is Jobgoblin open|closed|restart|reconnect|new address/i.test(afterClickText + afterReloadText + idleText);
    const hasWayBack = /Jobgoblin is open|open Jobgoblin again|window/i.test(afterReloadText);
    if (!tellsHer || !hasWayBack) finding({
      id: "J2-1",
      severity: "P3",
      title: "After a restart the old tab is stranded on a dead port; whether she is told what to do is below",
      persona: "Maya",
      area: "Browser tab after restart",
      prd: "R4 (crash recovery), 'nothing is lost'",
      expected: "An old tab says plainly that Jobgoblin restarted and how to open it again (or reconnects by itself).",
      actual: `Port changed: ${first.origin !== second.origin}; token changed: ${first.token !== second.token}. Tab text after reload: "${afterReloadText.replace(/\s+/g, " ").slice(0, 300)}". Tells her something: ${tellsHer}; says how to get back: ${hasWayBack}.`,
      evidence: [auditPath("j2-old-tab-text.json"), auditPath("screens", "j2"), auditPath("j2-restart.json")],
      suspectedFile: "apps/dashboard (api client error handling), packages/server/src/http/listen.ts (port 0). In the desktop app the window loads the new address itself, so this is a browser/dev-mode issue",
      wrong: "unclear" as const,
    });
  });

  await test.step("a new tab with the new address shows the same state", async () => {
    const tab = await context.newPage();
    await startRecordingRunCards(tab);
    await tab.goto(second.url);
    await expect(tab.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    await tab.screenshot({ path: auditPath("screens", "j2", "04-new-tab-today-before-find.png"), fullPage: true });
    const text = await tab.locator("main").innerText();
    writeEvidence("j2-today-after-restart.txt", text);
    // Overdue follow-up shows on Today
    const followUp = tab.getByRole("region", { name: "Needs you" }).getByTestId("needs-you-item").filter({ hasText: "Follow up" });
    const showsFollowUp = (await followUp.count()) > 0;
    // Acme (Applied) is not offered for review again; Brightpath still waits.
    await expect(needsYouItem(tab, BRIGHTPATH)).toContainText("Ready to review");
    const acmeStillOffered = (await needsYouItem(tab, ACME).filter({ hasText: "Ready to review" }).count()) > 0;
    expect.soft(showsFollowUp, "an overdue follow-up is on Today after the restart").toBe(true);
    expect.soft(acmeStillOffered, "an applied job is not offered for review again").toBe(false);
    if (!showsFollowUp) {
      finding({
        id: "J2-2",
        severity: "P2",
        title: "An overdue follow-up is not on Today after a restart",
        persona: "Alex",
        area: "Today",
        prd: "K2",
        expected: "Follow up item",
        actual: text.slice(0, 600),
        evidence: [auditPath("j2-today-after-restart.txt")],
        wrong: "product",
      });
    }

    // ---- second Find jobs: nothing is new
    const pipelineBefore = await second.api<{ id: string }[]>("/api/pipeline");
    await tab.getByRole("button", { name: "Find jobs" }).click();
    await waitUntilNoRunIsActive(second, 120_000);
    await tab.reload();
    await expect(tab.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    const afterFind = await tab.locator("main").innerText();
    const pipelineAfter = await second.api<{ id: string }[]>("/api/pipeline");
    await tab.screenshot({ path: auditPath("screens", "j2", "05-second-find-jobs.png"), fullPage: true });
    writeEvidence("j2-second-find.json", {
      pipelineBefore: pipelineBefore.length,
      pipelineAfter: pipelineAfter.length,
      todayText: afterFind,
      runCardTexts: await recordedRunCardTexts(tab),
    });
    expect.soft(pipelineAfter.length, "D3: the second Find jobs adds no duplicates").toBe(pipelineBefore.length);
    const saysNothingNew = /nothing new|no new|already/i.test(afterFind + (await recordedRunCardTexts(tab)).join(" "));
    if (!saysNothingNew) finding({
      id: "J2-3",
      severity: "P2",
      title: "A second Find jobs with nothing new does not say 'nothing new'",
      persona: "Maya",
      area: "Today / run card",
      prd: "D3, R1",
      expected: "A sentence like 'No new jobs since last time' so she knows the search ran and found nothing.",
      actual: `No duplicates added (pipeline ${pipelineBefore.length} -> ${pipelineAfter.length}). Today text after the run: "${afterFind.replace(/\s+/g, " ")}". Run card texts: ${JSON.stringify(await recordedRunCardTexts(tab))}. Says nothing new: ${saysNothingNew}`,
      evidence: [auditPath("j2-second-find.json"), auditPath("screens", "j2", "05-second-find-jobs.png")],
      suspectedFile: "apps/dashboard/src/screens/TodayScreen.tsx / RunCard.tsx; the hunt result summary",
      wrong: "product",
    });
    const finishedUnderRunning = /Running\s+(?:[\s\S]*?Finished)/.test(afterFind) && !/Working|Waiting for its turn/.test(afterFind);
    const isoDate = /\d{4}-\d{2}-\d{2}/.exec(afterFind)?.[0];
    if (finishedUnderRunning || isoDate !== undefined) {
      finding({
        id: "J2-4",
        severity: "P3",
        title: "On day 2 Today lists finished cards under the heading 'Running' (they pile up with every Find jobs), and shows follow-up dates as 2026-11-04",
        persona: "Maya",
        area: "Today",
        prd: "R1, voice rules (plain words)",
        expected: "Finished runs are tidy or labelled 'Finished'; dates read like 'Wednesday 4 November'.",
        actual: `'Running' section holds only finished cards: ${finishedUnderRunning}; date seen: ${isoDate ?? "none"}. Cards after one restart and a second Find jobs: ${(await recordedRunCardTexts(tab)).length} distinct.`,
        evidence: [auditPath("j2-second-find.json"), auditPath("screens", "j2", "05-second-find-jobs.png")],
        suspectedFile: "apps/dashboard/src/screens/TodayScreen.tsx (Running section), packages/server/src/services/today.ts (follow-up message with ISO date)",
        wrong: "product",
      });
    }
    void COPPERLEAF;
  });
});

