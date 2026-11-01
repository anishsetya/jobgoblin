// Helpers shared by this package's tests: where the feed fixtures live, how to read them, and the checks
// every parsed posting must pass. Tests never touch the network and never write files.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FeedPosting, type Company, type JobSource } from "@jobgoblin/schemas";
import { expect } from "vitest";

const FEEDS_DIR = fileURLToPath(new URL("../../../fixtures/feeds/", import.meta.url));

export const DEMO_FEEDS_DIR = path.join(FEEDS_DIR, "demo");

export function readRecordedFixture(fileName: string): string {
  return readFileSync(path.join(FEEDS_DIR, "recorded", fileName), "utf8");
}

export function readDemoCompanies(): Company[] {
  return JSON.parse(readFileSync(path.join(DEMO_FEEDS_DIR, "companies.json"), "utf8")) as Company[];
}

export function aWatchedCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: "greenhouse:acmecloud",
    name: "Acme Cloud",
    ats: "greenhouse",
    slug: "acmecloud",
    status: "Watching",
    ...overrides,
  };
}

// What every posting from every source must satisfy: valid by the shared schema, a readable id, and
// the fields a person needs to recognize the job.
export function expectUsablePosting(posting: FeedPosting, source: JobSource): void {
  expect(FeedPosting.safeParse(posting).success).toBe(true);
  expect(posting.source).toBe(source);
  expect(posting.jobId).toMatch(new RegExp(`^${source}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$`));
  expect(posting.company).not.toBe("");
  expect(posting.title).not.toBe("");
  expect(posting.location).not.toBe("");
  expect(posting.url).toMatch(/^https?:\/\//);
  expect(posting.text.trim()).not.toBe("");
  // Text is meant to be read, so no markup may be left in it.
  expect(posting.text).not.toMatch(/<\/?(p|div|li|ul|span|strong|h2)\b/i);
  expect(posting.text).not.toContain("&lt;");
}
