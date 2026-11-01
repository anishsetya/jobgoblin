// Story 8 (PRD S5 and K3): "My information is backed up, I can go back to an earlier day, and I can take my
// tracker to a spreadsheet."
// Covers S5 (Back up now shows the last backup time; Restore) and K3 (CSV and Excel download, header first).
import fs from "node:fs";
import { expect, test } from "../support/fixtures";
import { findJobsAndWaitForReview, goToPipeline } from "../support/flows";
import { approveAndMarkApplied, findApplicationId } from "../support/seed";

const TRACKER_HEADER = "Company,Role,Status,Fit,Band,Resume version,Applied on,Follow up on,Posting,Folder,Updated";

test.describe("As a job seeker, my data is safe and portable", () => {
  test("Back up now shows when the last backup was made", async ({ page, startServer }) => {
    const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
    await page.goto(server.url);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settings" }).click();

    const backups = page.getByRole("region", { name: "Backups" });
    await backups.getByRole("button", { name: "Back up now" }).click();

    await expect(backups).toContainText(/Last backup: .+/);
    await expect(backups).not.toContainText("No backup has been made yet.");
    await expect(backups.getByRole("button", { name: /^Restore the backup from / }).first()).toBeVisible();
  });

  test("my limits are checked, saved, and used the next time I apply", async ({ page, startServer }) => {
    const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
    await page.goto(server.url);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settings" }).click();
    const limits = page.getByRole("region", { name: "Limits" });

    await test.step("a follow-up of zero days is refused with a plain message", async () => {
      await limits.getByLabel("Days until a follow-up is due").fill("0");
      await limits.getByRole("button", { name: "Save" }).click();
      await expect(limits.getByText("Enter whole numbers. The first and last must be at least 1.")).toBeVisible();
    });

    await test.step("14 days is saved and kept after a reload", async () => {
      await limits.getByLabel("Days until a follow-up is due").fill("14");
      await limits.getByRole("button", { name: "Save" }).click();
      await expect(limits.getByRole("status")).toHaveText("Saved");

      await page.reload();
      await expect(page.getByRole("region", { name: "Limits" }).getByLabel("Days until a follow-up is due")).toHaveValue("14");
    });

    await test.step("the next application I send gets a follow-up two weeks later", async () => {
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Today" }).click();
      await findJobsAndWaitForReview(page);
      const acmeId = await findApplicationId(server, "Acme Cloud", "Backend Engineer");
      await approveAndMarkApplied(server, acmeId);

      const detail = await server.api<{ application: { followUpOn: string } }>(`/api/apps/${acmeId}`);
      const expected = new Date();
      expected.setDate(expected.getDate() + 14);
      const pad = (value: number): string => String(value).padStart(2, "0");
      expect(detail.application.followUpOn).toBe(`${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())}`);
    });
  });

  test("on a new computer, choosing my old folder offers my backups and Restore brings everything back", async ({ page, startServer }) => {
    const oldComputer = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
    const oldPage = await page.context().newPage();
    await oldPage.goto(oldComputer.url);
    await findJobsAndWaitForReview(oldPage);
    await oldComputer.api("/api/backups", { method: "POST", body: {} });
    await oldPage.close();
    await oldComputer.killHard();

    // A fresh app data folder, as if Jobgoblin had just been installed, but the same files folder (synced by Drive, say).
    const newComputer = await startServer({ personFolder: oldComputer.personFolder });
    await page.goto(newComputer.url);

    await test.step("the wizard starts from scratch and asks for the folder", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Welcome to Jobgoblin" })).toBeVisible();
      await page.goto(`${newComputer.origin}/setup/3`);
      await page.getByLabel("Folder", { exact: true }).fill(oldComputer.personFolder);
      await page.getByRole("button", { name: "Use this folder" }).click();
    });

    await test.step("it finds the backups in that folder and offers them", async () => {
      await expect(page.getByRole("heading", { name: "We found backups in this folder" })).toBeVisible();
      await page.getByRole("button", { name: /^Restore the backup from / }).first().click();
      await page.getByRole("dialog", { name: "Restore this backup?" }).getByRole("button", { name: "Restore" }).click();
    });

    await test.step("setup is skipped: I land on Today with my four applications back", async () => {
      await expect(page).toHaveURL(/\/today$/);
      await goToPipeline(page);
      await expect(page.getByTestId("pipeline-card")).toHaveCount(4);
    });
  });

  test("restoring an earlier backup brings back the earlier state, and the tracker downloads with its header first", async ({
    page,
    startServer,
  }) => {
    const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
    await page.goto(server.url);

    await test.step("I make a backup while my pipeline is still empty", async () => {
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settings" }).click();
      await page.getByRole("region", { name: "Backups" }).getByRole("button", { name: "Back up now" }).click();
      await expect(page.getByRole("region", { name: "Backups" })).toContainText(/Last backup: .+/);
    });

    await test.step("then I find jobs, and the pipeline fills up", async () => {
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Today" }).click();
      await findJobsAndWaitForReview(page);
      await goToPipeline(page);
      await expect(page.getByTestId("pipeline-card")).toHaveCount(4);
    });

    await test.step("Download CSV gives me a file whose first line is the header", async () => {
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settings" }).click();
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "Download CSV" }).click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/tracker\.csv$/i);

      const csv = fs.readFileSync(await download.path(), "utf8").replace(/^﻿/, "");
      const lines = csv.split(/\r?\n/).filter((line) => line !== "");
      expect(lines[0]).toBe(TRACKER_HEADER);
      expect(lines).toHaveLength(1 + 4);
      expect(csv).toContain("Acme Cloud");
    });

    await test.step("Download Excel file gives me a real workbook", async () => {
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "Download Excel file" }).click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/tracker\.xlsx$/i);
      expect(fs.readFileSync(await download.path()).subarray(0, 2).toString()).toBe("PK"); // an .xlsx is a zip
    });

    await test.step("I restore the earliest backup, after confirming", async () => {
      const backups = page.getByRole("region", { name: "Backups" });
      await backups.getByRole("button", { name: /^Restore the backup from / }).last().click();

      const dialog = page.getByRole("dialog", { name: "Restore this backup?" });
      await expect(dialog).toContainText("Your current information is saved as a backup first");
      await dialog.getByRole("button", { name: "Restore" }).click();
      await expect(dialog).toBeHidden();
    });

    await test.step("the pipeline is empty again, as it was when that backup was made", async () => {
      await goToPipeline(page);
      await expect(page.getByText("No applications yet")).toBeVisible();
      await expect(page.getByTestId("pipeline-card")).toHaveCount(0);
    });

    await test.step("restoring kept me signed in to my setup: I am still on my own folder, not back at the wizard", async () => {
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settings" }).click();
      await expect(page.getByText(server.personFolder, { exact: false })).toBeVisible();
      await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Today" }).click();
      await expect(page.getByRole("button", { name: "Find jobs" })).toBeVisible();
    });

    await test.step("and the state before the restore was saved as a backup too, so nothing is lost", async () => {
      const list = await server.api<{ id: string }[]>("/api/backups");
      expect(list.length).toBeGreaterThanOrEqual(2);
    });
  });
});
