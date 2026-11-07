// J5: paste a job. Greenhouse, Lever, Ashby and LinkedIn links; a bad URL; text only; the same job twice; very long
// text; <script> and <img onerror> in the text. Is each handled once, shown as plain text, and is every error actionable?
import type { Page } from "@playwright/test";
import { test, expect } from "./auditFixtures";
import { writeEvidence } from "./common";
import { auditPath } from "./paths";
import { finding } from "./record";
import { completeWizardViaUi } from "./wizard";
import { waitUntilNoRunIsActive } from "../support/waits";

type Row = { id: string; company: string; title: string; status: string };

async function openDialog(page: Page) {
  await page.goto(`${new URL(page.url()).origin}/today`);
  await page.getByRole("button", { name: "Add a job" }).click();
  return page.getByRole("dialog", { name: "Add a job" });
}

test("J5: paste a job", async ({ page, startServer }) => {
  const server = await startServer({ seed: "none" });
  await completeWizardViaUi(page, server);
  const evidence: Record<string, unknown> = {};
  const pipeline = () => server.api<Row[]>("/api/pipeline");

  async function tryLink(name: string, url: string, expectCompany?: string) {
    const before = (await pipeline()).length;
    const dialog = await openDialog(page);
    await dialog.getByLabel("Link to the job").fill(url);
    await dialog.getByRole("button", { name: "Add job" }).click();
    await page.waitForTimeout(1500);
    const dialogOpen = await dialog.isVisible().catch(() => false);
    const dialogText = dialogOpen ? (await dialog.innerText()).replace(/\s+/g, " ") : "";
    const status = (await page.getByRole("status").allTextContents()).join(" | ");
    const alert = (await page.getByRole("alert").allTextContents()).join(" | ");
    await waitUntilNoRunIsActive(server, 120_000);
    const rows = await pipeline();
    await page.screenshot({ path: auditPath("screens", "j5", `${name}.png`), fullPage: true });
    const todayText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    evidence[name] = {
      todayText,
      url,
      dialogStayedOpen: dialogOpen,
      dialogText,
      statusText: status,
      alertText: alert,
      rowsBefore: before,
      rowsAfter: rows.length,
      newRows: rows.slice(0, rows.length).filter((row) => expectCompany === undefined || row.company === expectCompany).map((r) => `${r.title} at ${r.company}: ${r.status}`),
    };
    if (dialogOpen) await page.keyboard.press("Escape");
  }

  await tryLink("1-greenhouse", "https://boards.greenhouse.io/gridline/jobs/4100", "Gridline Energy");
  await tryLink("2-lever", "https://jobs.lever.co/brightpath/7c1d0e02-3f4a-4b5c-8d6e-0000000b0006", "Brightpath");
  await tryLink("3-ashby", "https://jobs.ashbyhq.com/copperleaf/9a8b7c03-1d2e-4f3a-8b4c-0000000c0003", "Copperleaf AI");
  await tryLink("4-linkedin", "https://www.linkedin.com/jobs/view/3912345678");
  await tryLink("5-bad-url", "this is not a link");
  await tryLink("5b-unknown-site", "https://example.invalid/jobs/1");

  // ---- same job twice (Gridline again, plus a text-only duplicate)
  await tryLink("6-same-job-twice", "https://boards.greenhouse.io/gridline/jobs/4100", "Gridline Energy");
  evidence["6-gridline-rows"] = (await pipeline()).filter((row) => row.company === "Gridline Energy").length;

  // ---- text only: missing company/title
  {
    const dialog = await openDialog(page);
    await dialog.getByRole("button", { name: "Paste the job text instead" }).click();
    await dialog.getByLabel("Job description").fill("Python backend role, PostgreSQL, AWS. 2+ years.");
    await dialog.getByRole("button", { name: "Add job" }).click();
    await page.waitForTimeout(800);
    evidence["7-text-only-no-company"] = {
      dialogText: (await dialog.innerText()).replace(/\s+/g, " "),
      alerts: await dialog.getByRole("alert").allTextContents(),
      invalidFields: await dialog.locator("[aria-invalid='true']").count(),
    };
    await page.screenshot({ path: auditPath("screens", "j5", "7-text-only-no-company.png"), fullPage: true });
    await page.keyboard.press("Escape");
  }

  // ---- very long text (600 KB)
  {
    const long = "We build Python services on PostgreSQL with Docker and AWS. ".repeat(10_000);
    const before = (await pipeline()).length;
    const dialog = await openDialog(page);
    await dialog.getByRole("button", { name: "Paste the job text instead" }).click();
    await dialog.getByLabel("Company").fill("Longtext Inc");
    await dialog.getByLabel("Job title").fill("Backend Engineer");
    await dialog.getByLabel("Job description").fill(long);
    const started = Date.now();
    await dialog.getByRole("button", { name: "Add job" }).click();
    await page.waitForTimeout(2500);
    const dialogOpen = await dialog.isVisible().catch(() => false);
    const text = dialogOpen ? (await dialog.innerText()).replace(/\s+/g, " ").slice(0, 400) : "";
    await waitUntilNoRunIsActive(server, 180_000);
    const rows = await pipeline();
    evidence["8-long-text"] = {
      chars: long.length,
      dialogStayedOpen: dialogOpen,
      dialogText: text,
      rowsBefore: before,
      rowsAfter: rows.length,
      row: rows.find((row) => row.company === "Longtext Inc")?.status,
      seconds: (Date.now() - started) / 1000,
    };
    await page.screenshot({ path: auditPath("screens", "j5", "8-long-text.png"), fullPage: true });
    if (dialogOpen) await page.keyboard.press("Escape");
  }

  // ---- markup in the text
  {
    await page.addInitScript(() => {
      (window as unknown as { __pwned?: number }).__pwned = 0;
    });
    const dialog = await openDialog(page);
    await dialog.getByRole("button", { name: "Paste the job text instead" }).click();
    await dialog.getByLabel("Company").fill("Evil <b>Corp</b>");
    await dialog.getByLabel("Job title").fill("Backend <script>window.__pwned=1</script> Engineer");
    await dialog
      .getByLabel("Job description")
      .fill('Python and PostgreSQL role. <script>window.__pwned=2</script><img src=x onerror="window.__pwned=3"> <a href="javascript:window.__pwned=4">apply</a> evil.example 2+ years.');
    await dialog.getByRole("button", { name: "Add job" }).click();
    await waitUntilNoRunIsActive(server, 120_000);
    await page.reload();
    const row = (await pipeline()).find((r) => r.company.includes("Evil"));
    evidence["9-markup-row"] = row === undefined ? null : `${row.title} at ${row.company}: ${row.status}`;
    const results: Record<string, unknown> = {};
    if (row !== undefined) {
      for (const where of [`/today`, `/pipeline`, `/apps/${row.id}`, `/review/${row.id}`]) {
        await page.goto(`${server.origin}${where}`);
        await page.waitForTimeout(1200);
        const html = await page.locator("main").innerHTML();
        results[where] = {
          rawTagsInDom: /<script|<img[^>]+onerror/i.test(html.replace(/&lt;/g, "")) && /<script[^>]*>window\.__pwned|<img src="x"/i.test(html),
          visibleText: (await page.locator("main").innerText()).includes("<script>"),
          pwned: await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
          injectedImg: await page.locator("main img[src='x']").count(),
        };
      }
      await page.goto(`${server.origin}/apps/${row.id}`);
      await page.screenshot({ path: auditPath("screens", "j5", "9-markup-application.png"), fullPage: true });
    }
    evidence["9-markup-results"] = results;
  }

  writeEvidence("j5-evidence.json", evidence);

  // ---- judgement
  const e = evidence as Record<string, any>;
  {
    const lever = e["2-lever"] as { newRows: string[]; todayText: string };
    const skipped = lever.newRows.some((r) => /Skipped \(low fit\)/.test(r));
    const toldAboutIt = /Senior Staff/.test(lever.todayText.split("Running")[0] ?? "");
    if (skipped && !toldAboutIt) {
      finding({
        id: "J5-1",
        severity: "P2",
        title: "A job she pasted herself ends up Skipped (low fit) and nothing on Today says so; it just never appears under Needs you",
        persona: "Maya",
        area: "Add a job / Today",
        prd: "D2",
        expected: "A line such as 'Senior Staff Engineer at Brightpath scored 20, a low fit. Tailor a resume anyway?' on Today.",
        actual: `After 'Added. Jobgoblin is scoring it now.' the row became ${lever.newRows.join("; ")}. Needs-you area of Today: "${(lever.todayText.split("Running")[0] ?? "").slice(0, 300)}"`,
        evidence: [auditPath("j5-evidence.json"), auditPath("screens", "j5", "2-lever.png")],
        suspectedFile: "packages/server/src/services/today.ts (needs-you kinds have no entry for a skipped pasted job)",
        wrong: "product",
      });
    }
  }
  const gridlineRows = e["6-gridline-rows"] as number;
  expect.soft(gridlineRows, "the same job twice is one row").toBe(1);
  const unsafe = Object.values((e["9-markup-results"] ?? {}) as Record<string, any>).some((r) => r.pwned || r.injectedImg > 0 || r.rawTagsInDom);
  if (unsafe) {
    finding({
      id: "J5-P0",
      severity: "P0",
      title: "Markup pasted in a job runs on a dashboard screen",
      persona: "Both",
      area: "Job description display",
      prd: "Security",
      expected: "Plain text",
      actual: JSON.stringify(e["9-markup-results"]),
      evidence: [auditPath("j5-evidence.json")],
      wrong: "product",
    });
  }
  for (const key of ["4-linkedin", "5-bad-url", "5b-unknown-site"]) {
    const item = e[key] as { dialogStayedOpen: boolean; dialogText: string; statusText: string; alertText: string; rowsBefore: number; rowsAfter: number };
    void item;
  }
  writeEvidence("j5-summary.txt", Object.entries(e).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n"));
});


// The same job found by Find jobs and then pasted by link: is it one application or two?
test("J5b: pasting a link to a job that Find jobs already found", async ({ page, startServer }) => {
  const server = await startServer({ seed: "none" });
  await completeWizardViaUi(page, server);
  await page.getByRole("button", { name: "Find jobs" }).click();
  await waitUntilNoRunIsActive(server, 120_000);
  const before = await server.api<Row[]>("/api/pipeline");
  const links: [string, string][] = [
    ["greenhouse Acme", "https://boards.greenhouse.io/acmecloud/jobs/4012345"],
    ["lever Brightpath", "https://jobs.lever.co/brightpath/7c1d0e02-3f4a-4b5c-8d6e-0000000b0002"],
    ["ashby Copperleaf", "https://jobs.ashbyhq.com/copperleaf/9a8b7c03-1d2e-4f3a-8b4c-0000000c0003"],
  ];
  const out: Record<string, unknown> = { before: before.map((r) => `${r.title} at ${r.company}: ${r.status}`) };
  for (const [name, url] of links) {
    const dialog = await openDialog(page);
    await dialog.getByLabel("Link to the job").fill(url);
    await dialog.getByRole("button", { name: "Add job" }).click();
    await page.waitForTimeout(1500);
    await waitUntilNoRunIsActive(server, 120_000);
    out[name] = (await page.getByRole("status").allTextContents()).join(" | ");
  }
  const after = await server.api<Row[]>("/api/pipeline");
  out.after = after.map((r) => `${r.title} at ${r.company}: ${r.status}`);
  out.countBefore = before.length;
  out.countAfter = after.length;
  writeEvidence("j5b-evidence.json", out);
  const titles = after.map((r) => `${r.title}`);
  const duplicates = titles.filter((title, index) => titles.indexOf(title) !== index && !/QA|Data Analyst/.test(title));
  out.duplicateTitles = duplicates;
  writeEvidence("j5b-evidence.json", out);
  expect.soft(duplicates, "a job Find jobs already found is not added a second time").toEqual([]);
  if (duplicates.length > 0) {
    finding({
      id: "J5-2",
      severity: "P2",
      title: "Pasting the link to a job Find jobs already found creates a second application, because the pasted one gets a different company name",
      persona: "Alex",
      area: "Add a job / dedupe",
      prd: "D2, D3 ('the same job never appears twice')",
      expected: "'You already have this job.'",
      actual: `Pipeline before ${before.length}, after ${after.length}. Duplicated titles: ${duplicates.join(", ")}. Rows: ${JSON.stringify(out.after)}`,
      evidence: [auditPath("j5b-evidence.json")],
      suspectedFile: "packages/server/src/services/jobs.ts:102-125 (dedupe key uses the company name derived from the link slug, 'Copperleaf', not the feed's 'Copperleaf AI'; core/jobFilters.ts:86-89)",
      wrong: "product",
    });
  }
});
