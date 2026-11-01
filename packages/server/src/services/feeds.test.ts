import { afterEach, describe, expect, it } from "vitest";
import { getJob, listCompanies, listUnseenJobs, getFeedCacheEntry } from "@jobgoblin/storage";
import { createFeedCache } from "../feedCache";
import { refreshFeeds, seedCompaniesIfEmpty } from "./feeds";
import { closeTestContexts, createTestContext } from "./testSupport";

afterEach(closeTestContexts);

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
