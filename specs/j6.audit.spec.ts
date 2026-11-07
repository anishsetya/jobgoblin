// J6: limits. A fourth application at one company; a reapply inside 90 days. Is the message visible before
// tailoring (T4), and does it say what to do? Preconditions (three jobs at one company) are set through the API.
import { test, expect } from "./auditFixtures";
import { writeEvidence } from "./common";
import { auditPath } from "./paths";
import { finding } from "./record";
import { completeWizardViaUi } from "./wizard";
import { approveAndMarkApplied } from "../support/seed";
import { waitUntilNoRunIsActive } from "../support/waits";

type Row = { id: string; company: string; title: string; status: string; tailorError: string | null };

const text = (role: string) =>
  `Limitco is hiring a ${role}. You will build Python services on PostgreSQL, deploy with Docker and Kubernetes on AWS. 2+ years of experience building backend services.`;

test("J6: the fourth application at one company, and applying again within 90 days", async ({ page, startServer }) => {
  const server = await startServer({ seed: "none" });
  await completeWizardViaUi(page, server);
  const evidence: Record<string, unknown> = {};
  evidence.settings = await server.api("/api/settings");

  // Three applications at Limitco through the API (precondition).
  const roles = ["Backend Engineer", "Platform Engineer", "Software Engineer"];
  for (const role of roles) {
    await server.api("/api/jobs", { body: { text: text(role), company: "Limitco", title: role, location: "Remote, US" } });
    await waitUntilNoRunIsActive(server, 120_000);
  }
  const three = (await server.api<Row[]>("/api/pipeline")).filter((row) => row.company === "Limitco");
  evidence.threeRows = three.map((row) => `${row.title}: ${row.status}`);

  // The fourth, by hand in the UI, as a person would.
  await page.goto(`${server.origin}/today`);
  await page.getByRole("button", { name: "Add a job" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a job" });
  await dialog.getByRole("button", { name: "Paste the job text instead" }).click();
  await dialog.getByLabel("Company").fill("Limitco");
  await dialog.getByLabel("Job title").fill("Data Engineer");
  await dialog.getByLabel("Place (optional)").fill("Remote, US");
  await dialog.getByLabel("Job description").fill(text("Data Engineer"));
  await dialog.getByRole("button", { name: "Add job" }).click();
  await page.waitForTimeout(1500);
  evidence.statusAfterAdd = (await page.getByRole("status").allTextContents()).join(" | ");
  await waitUntilNoRunIsActive(server, 120_000);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  const todayText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  evidence.todayAfterFourth = todayText;
  await page.screenshot({ path: auditPath("screens", "j6", "01-today-after-fourth.png"), fullPage: true });
  const rows = await server.api<Row[]>("/api/pipeline");
  const fourth = rows.find((row) => row.company === "Limitco" && row.title === "Data Engineer");
  evidence.fourthRow = fourth === undefined ? null : { status: fourth.status, tailorError: fourth.tailorError };

  if (fourth !== undefined) {
    await page.goto(`${server.origin}/apps/${fourth.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Data Engineer" })).toBeVisible();
    await expect(page.getByText("Loading...")).toHaveCount(0);
    evidence.fourthPageText = (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 900);
    await page.screenshot({ path: auditPath("screens", "j6", "02-fourth-application-page.png"), fullPage: true });
    const tailor = page.getByRole("button", { name: "Tailor a resume" });
    if (await tailor.count()) {
      await tailor.click();
      await page.waitForTimeout(1500);
      evidence.afterTailorClick = (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 900);
      evidence.afterTailorAlerts = await page.getByRole("alert").allTextContents();
      await page.screenshot({ path: auditPath("screens", "j6", "03-after-tailor-click-on-fourth.png"), fullPage: true });
    }
  }

  // ---- reapply: apply to the first Limitco job, then add the same job again
  const first = three.find((row) => row.title === "Backend Engineer");
  if (first !== undefined) {
    await approveAndMarkApplied(server, first.id);
    await waitUntilNoRunIsActive(server, 120_000);
    await page.goto(`${server.origin}/today`);
    await page.getByRole("button", { name: "Add a job" }).click();
    const again = page.getByRole("dialog", { name: "Add a job" });
    await again.getByRole("button", { name: "Paste the job text instead" }).click();
    await again.getByLabel("Company").fill("Limitco");
    await again.getByLabel("Job title").fill("Backend Engineer");
    await again.getByLabel("Place (optional)").fill("Remote, US");
    await again.getByLabel("Job description").fill(text("Backend Engineer"));
    await again.getByRole("button", { name: "Add job" }).click();
    await page.waitForTimeout(1500);
    evidence.reapplyStatus = (await page.getByRole("status").allTextContents()).join(" | ");
    evidence.reapplyAlerts = await page.getByRole("alert").allTextContents();
    await page.screenshot({ path: auditPath("screens", "j6", "04-reapply-message.png"), fullPage: true });
  }
  writeEvidence("j6-evidence.json", evidence);

  // ---- judgement
  const saysLimit = /three|3 open|open application|limit|too many|already have/i.test(`${String(evidence.statusAfterAdd)} ${todayText} ${String(evidence.fourthPageText)} ${String(evidence.afterTailorClick)}`);
  const hasWhatToDo = /Settings|raise|change the limit|finish|withdraw|skip/i.test(`${todayText} ${String(evidence.fourthPageText)} ${String(evidence.afterTailorClick)}`);
  expect.soft(saysLimit, "T4: the limit is explained before anything is tailored").toBe(true);
  if (!saysLimit || !hasWhatToDo) {
    finding({
      id: "J6-1",
      severity: "P2",
      title: "A fourth application at one company is held back, but the screens do not clearly say that the company limit is why or what to do",
      persona: "Alex",
      area: "Today / Application page",
      prd: "T4 (limit shown before tailoring)",
      expected: "'You already have 3 open applications at Limitco. Finish or withdraw one, or raise the limit in Settings.'",
      actual: `Status after add: "${String(evidence.statusAfterAdd)}". Fourth row: ${JSON.stringify(evidence.fourthRow)}. Page text: "${String(evidence.fourthPageText).slice(0, 400)}". After Tailor click: "${String(evidence.afterTailorClick ?? "")}". Says limit: ${saysLimit}; says what to do: ${hasWhatToDo}`,
      evidence: [auditPath("j6-evidence.json"), auditPath("screens", "j6")],
      suspectedFile: "packages/server/src/services/tailoring.ts:24-31,90-115",
      wrong: "product",
    });
  }
});
