// Runs axe-core on the current page with the WCAG 2.1 level A and AA rules, and fails with a message that
// names each problem, the rule that found it and the element, so a failure can be fixed without a debugger.
// Spec: ARCHITECTURE.md section 12 ("Playwright runs axe on every screen") and the PRD's accessibility target.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

const WCAG_21_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

export async function expectNoAccessibilityViolations(page: Page, screenName: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_21_AA_TAGS).analyze();

  const report = results.violations.map((violation) => {
    const elements = violation.nodes.slice(0, 5).map((node) => `    ${node.target.join(" ")}\n      ${node.failureSummary?.split("\n")[1] ?? ""}`);
    return `  ${violation.id} (${violation.impact ?? "unknown"}): ${violation.help}\n${elements.join("\n")}`;
  });
  expect(report, `${screenName} has accessibility violations:\n${report.join("\n")}`).toEqual([]);
}
