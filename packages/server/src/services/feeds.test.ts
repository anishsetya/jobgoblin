import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getJob, listCompanies, listUnseenJobs, getFeedCacheEntry } from "@jobgoblin/storage";
import { createFeedCache } from "../feedCache";
import { readSeedCompanies, refreshFeeds, seedCompaniesIfEmpty } from "./feeds";
import { closeTestContexts, createTestContext, demoFeedsDir } from "./testSupport";

const boardFolders: string[] = [];

afterEach(() => {
  closeTestContexts();
  for (const folder of boardFolders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

// A demo job board folder holding only a companies.json with this text (none when the text is null).
function aBoardFolder(companiesJson: string | null): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "jobgoblin-board-"));
  boardFolders.push(folder);
  if (companiesJson !== null) fs.writeFileSync(path.join(folder, "companies.json"), companiesJson);
  return folder;
}

describe("readSeedCompanies, for the demo job board folder", () => {
  it("reads the demo board's three companies", () => {
    expect(readSeedCompanies(demoFeedsDir()).map((company) => company.name)).toEqual(["Acme Cloud", "Brightpath", "Copperleaf AI"]);
  });

  it("says in one line that the folder doesn't exist, and what to point it at", () => {
    const missing = path.join(aBoardFolder(null), "feeds-typo");

    expect(() => readSeedCompanies(missing)).toThrowError(
      `The demo job board folder ${missing} doesn't exist. Point JOBGOBLIN_FEED_FIXTURES at fixtures/feeds/demo, or leave it unset to read the real job boards.`,
    );
  });

  it("names the missing companies.json and what it must hold", () => {
    const folder = aBoardFolder(null);

    expect(() => readSeedCompanies(folder)).toThrowError(
      `The demo job board folder ${folder} has no companies.json. Add one: a JSON list of companies, each with id, name, ats, slug and status, like fixtures/feeds/demo/companies.json.`,
    );
  });

  it("says a companies.json that is not JSON is not valid JSON, never a parser's message", () => {
    const folder = aBoardFolder("[{ name: Acme }");

    expect(() => readSeedCompanies(folder)).toThrowError(`${path.join(folder, "companies.json")} is not valid JSON.`);
  });

  it("points at the first company that is missing something", () => {
    const folder = aBoardFolder('[{"id":"greenhouse:acme","name":"Acme","ats":"greenhouse","slug":"acme","status":"Watching"},{"name":"Brightpath"}]');

    expect(() => readSeedCompanies(folder)).toThrowError(`${path.join(folder, "companies.json")} is not a list of companies (see 1.id).`);
  });
});

describe("refreshFeeds with the demo job board", () => {
  it("seeds the three demo companies on the first start", () => {
    const ctx = createTestContext();

    const added = seedCompaniesIfEmpty(ctx);

    expect(added).toBe(3);
    expect(listCompanies(ctx.db).map((company) => company.name)).toEqual(["Acme Cloud", "Brightpath", "Copperleaf AI"]);
    expect(seedCompaniesIfEmpty(ctx)).toBe(0);
  });

  it("seeds the built-in list of well-known companies when it is not running on the demo board", () => {
    const ctx = createTestContext();
    ctx.options = { ...ctx.options, feedFixturesDir: null };

    const added = seedCompaniesIfEmpty(ctx);

    expect(added).toBeGreaterThan(20);
    expect(listCompanies(ctx.db).every((company) => company.status === "Watching" || company.status === "Suggested")).toBe(true);
  });

  it("keeps the four jobs a person would want to see and stores the other three with a reason", async () => {
    const ctx = createTestContext();

    const report = await refreshFeeds(ctx);

    expect(report.failures).toEqual([]);
    expect(report).toMatchObject({ added: 4, filtered: 2, duplicates: 1 });
    const shown = listUnseenJobs(ctx.db, 50).map((job) => job.title).sort();
    expect(shown).toEqual(["Backend Engineer", "Data Analyst", "Platform Engineer", "Software Engineer, Applied AI"]);
  });

  it("drops the QA role and the 8+ years role with the reason, and the repeat posting as a duplicate", async () => {
    const ctx = createTestContext();

    await refreshFeeds(ctx);

    const qa = getJob(ctx.db, "greenhouse:acmecloud:4012399");
    const senior = getJob(ctx.db, "lever:brightpath:7c1d0e02-3f4a-4b5c-8d6e-0000000b0006");
    const repeat = getJob(ctx.db, "hn:hn:40000007");
    expect(qa?.filteredReason).toContain("role you chose to avoid");
    expect(senior?.filteredReason).toContain("years of experience");
    expect(repeat?.filteredReason).toContain("same role");
  });

  it("gives every stored job a region and a dedupe key, and the first posting wins the dedupe", async () => {
    const ctx = createTestContext();

    await refreshFeeds(ctx);

    const first = getJob(ctx.db, "greenhouse:acmecloud:4012345");
    expect(first?.region).toBe("US");
    expect(first?.filteredReason).toBeNull();
    expect(first?.dedupeKey).toBe(getJob(ctx.db, "hn:hn:40000007")?.dedupeKey);
  });

  it("does not store anything twice when it runs again", async () => {
    const ctx = createTestContext();
    await refreshFeeds(ctx);

    const second = await refreshFeeds(ctx);

    expect(second).toMatchObject({ added: 0, filtered: 0, duplicates: 0 });
  });
});

describe("the feed cache", () => {
  it("stores a body compressed and gives back the same text", () => {
    const ctx = createTestContext();
    const cache = createFeedCache(() => ctx.db);
    const body = JSON.stringify({ jobs: "x".repeat(50_000) });

    cache.write("https://example.com/feed", { etag: '"abc"', lastModified: null, body, fetchedAt: "2026-10-31T14:05:00.000Z" });

    const stored = getFeedCacheEntry(ctx.db, "https://example.com/feed");
    expect(stored?.body.length).toBeLessThan(body.length / 10);
    expect(cache.read("https://example.com/feed")).toMatchObject({ etag: '"abc"', body });
  });

  it("returns null for an address it has never seen", () => {
    const ctx = createTestContext();

    expect(createFeedCache(() => ctx.db).read("https://example.com/none")).toBeNull();
  });
});
