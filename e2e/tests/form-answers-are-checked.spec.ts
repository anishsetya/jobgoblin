// Story 19 (PRD P3; issue #29): "Form answers tells me at once when a detail can't be used, next to its box."
// A banned word or a value far too long is refused when I save, under the box it is about, instead of at
// Approve. An email address or phone number that doesn't look like one is saved with a note under its box,
// because formats vary by country. Alex's banned words are "rockstar" and "ninja".
import type { Locator, Page } from "@playwright/test";
import { expectNoAccessibilityViolations } from "../support/axe";
import { expect, test } from "../support/fixtures";

const SEEDED = { seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } } as const;
const ROCKSTAR_IS_BANNED = /^Full name: "rockstar" is on your banned words list\./;
const EMAIL_LOOKS_WRONG = "This doesn't look like an email address. It is saved; check it before you apply.";

test.describe("As a job seeker, Form answers tells me at once when a detail can't be used", () => {
  test("a banned word is refused under its box, and an email address that looks wrong is saved with a note", async ({ page, startServer }) => {
    const server = await startServer(SEEDED);
    await page.goto(server.url);
    await openFormAnswers(page);
    const fullName = page.getByLabel("Full name");
    const email = page.getByLabel("Email address");

    await test.step("a banned word in my name is refused under the box, and nothing is saved", async () => {
      await fullName.fill("Alex Rockstar Rivera");
      await email.fill("alex.r@example.com");
      await saveButton(page).click();

      await expect(fullName).toHaveAttribute("aria-invalid", "true");
      await expect(fullName).toHaveAccessibleDescription(ROCKSTAR_IS_BANNED);
      await expect(errorNotice(page)).toContainText("Change it, then save again.");
      await expect(page.getByText("Saved", { exact: true })).toHaveCount(0);
      const saved = await server.api<{ profile: { contact: { fullName: string; email: string } } }>("/api/profile");
      expect(saved.profile.contact).toMatchObject({ fullName: "Alex Rivera", email: "alex.rivera@example.com" });
      await expectNoAccessibilityViolations(page, "Form answers with a refused name");
    });

    await test.step("changing the name clears the refusal", async () => {
      await fullName.fill("Alex Rivera");

      await expect(fullName).not.toHaveAttribute("aria-invalid", "true");
      await expect(errorNotice(page)).toHaveCount(0);
    });

    await test.step("an email address with no @ is saved, with a note under its box", async () => {
      await email.fill("not-an-email");
      await saveButton(page).click();

      await expect(savedNote(page)).toHaveText("Saved. Check the note under Email address above.");
      await expect(email).toHaveAccessibleDescription(EMAIL_LOOKS_WRONG);
      await expect(email).not.toHaveAttribute("aria-invalid", "true");
      await expectNoAccessibilityViolations(page, "Form answers with a note about the email address");
    });

    await test.step("the note is still there the next time, and goes once the address is fixed", async () => {
      await page.reload();
      await expect(email).toHaveValue("not-an-email");
      await expect(email).toHaveAccessibleDescription(EMAIL_LOOKS_WRONG);

      await email.fill("alex.rivera@example.com");
      await expect(email).toHaveAccessibleDescription(""); // the note is about the saved value
      await saveButton(page).click();
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
      await expect(email).toHaveAccessibleDescription("");
    });
  });

  test("in the setup wizard, a new note keeps me on the step until I have seen it", async ({ page, startServer }) => {
    const server = await startServer(SEEDED);
    await page.goto(server.url);
    await expect(page).toHaveURL(/\/today$/);
    await page.goto(`${server.origin}/setup/6`);
    const phone = page.getByLabel("Phone number");
    await expect(phone).toHaveValue("+1 555 0100");

    await phone.fill("call me");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(savedNote(page)).toHaveText("Saved. Check the note under Phone number above, then save again to go on.");
    await expect(phone).toHaveAccessibleDescription(/^This doesn't look like a phone number\./);
    await expect(page).toHaveURL(/\/setup\/6$/);

    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page).toHaveURL(/\/setup\/7$/);
  });
});

async function openFormAnswers(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Profile" }).click();
  await page.getByRole("tab", { name: "Form answers" }).click();
  await expect(page.getByLabel("Full name")).toHaveValue("Alex Rivera");
}

function saveButton(page: Page): Locator {
  return page.getByRole("button", { name: "Save", exact: true });
}

// What the form says next to its button once it has saved.
function savedNote(page: Page): Locator {
  return page.getByRole("status").filter({ hasText: /^Saved/ });
}

// The notice under the Save button, which says what was refused and what to do.
function errorNotice(page: Page): Locator {
  return page.getByRole("main").getByRole("alert");
}
