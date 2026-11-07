// Page checks that can run on any screen: voice (jargon the PRD bans, exclamation marks, raw keys), layout
// (one accent button, no horizontal scroll), axe, and a screenshot. Each problem goes to observations.jsonl with the
// screen's name; the caller (or the audit's judge) decides whether it becomes a finding.
//   const result = await sweep(page, "Today (empty)", { screenshot: "screens/sweep/today-empty.png" });
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { auditPath } from "./paths";
import { observation } from "./record";

// Words a person who is not technical should not meet (PRD voice rules). "token" and "API" can appear in a
// legitimate sentence about a job, so these are reported as observations, never assumed to be bugs.
const JARGON = /\b(MCP|tokens?|prompts?|headless|API|JSON|stack ?trace|stderr|stdout|undefined|NaN|null|ENOENT|EPERM|exception|traceback)\b/g;
// Raw translation keys ("review:position") and unfilled placeholders ("{{count}}", "{company}").
const RAW_KEY = /\b(?:common|profile|setup|today|review|apply|application|pipeline|settings):[A-Za-z_.]+\b/g;
const PLACEHOLDER = /\{\{[^}]+\}\}|\{[a-zA-Z]+\}/g;

export type SweepResult = {
  screen: string;
  url: string;
  jargon: string[];
  exclamations: string[];
  rawKeys: string[];
  placeholders: string[];
  accentButtons: number;
  horizontalOverflow: boolean;
  scrollWidth: number;
  clientWidth: number;
  axeViolations: string[];
  text: string;
};

export type SweepOptions = {
  screenshot?: string; // path relative to AUDIT_DIR
  axe?: boolean; // default true
  fullPage?: boolean; // default true
};

export async function sweep(page: Page, screen: string, options: SweepOptions = {}): Promise<SweepResult> {
  const text = await page.evaluate(() => document.body.innerText);

  const jargon = unique(text.match(JARGON) ?? []);
  const exclamations = text.split(/\n/).filter((line) => line.includes("!"));
  const rawKeys = unique(text.match(RAW_KEY) ?? []);
  const placeholders = unique(text.match(PLACEHOLDER) ?? []);

  // The accent button is the one with the accent background; count visible ones.
  const layout = await page.evaluate(() => {
    const accent = [...document.querySelectorAll("button, a")].filter((element) => {
      const className = typeof element.className === "string" ? element.className : "";
      const rect = element.getBoundingClientRect();
      return /\bbg-accent\b/.test(className) && rect.width > 0 && rect.height > 0;
    });
    const root = document.scrollingElement ?? document.documentElement;
    return { accent: accent.length, scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });

  const axeViolations: string[] = [];
  if (options.axe !== false) {
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    for (const violation of results.violations) {
      axeViolations.push(`${violation.id} (${violation.impact ?? "?"}): ${violation.help} [${violation.nodes.length} elements]`);
    }
  }

  if (options.screenshot !== undefined) {
    await page.screenshot({ path: auditPath(options.screenshot), fullPage: options.fullPage !== false });
  }

  const result: SweepResult = {
    screen,
    url: page.url(),
    jargon,
    exclamations,
    rawKeys,
    placeholders,
    accentButtons: layout.accent,
    horizontalOverflow: layout.scrollWidth > layout.clientWidth,
    scrollWidth: layout.scrollWidth,
    clientWidth: layout.clientWidth,
    axeViolations,
    text,
  };

  const { text: _text, ...summary } = result;
  const hasProblem =
    jargon.length > 0 ||
    exclamations.length > 0 ||
    rawKeys.length > 0 ||
    placeholders.length > 0 ||
    layout.accent > 1 ||
    result.horizontalOverflow ||
    axeViolations.length > 0;
  observation(hasProblem ? "sweep-problem" : "sweep-clean", summary);
  return result;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
