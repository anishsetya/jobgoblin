import { afterEach, describe, expect, it } from "vitest";
import {
  getFeedCacheEntry,
  getJob,
  getProfileSection,
  listCompanies,
  listUnseenJobs,
  markJobsSeen,
  saveProfileSection,
} from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { createFeedCache } from "../feedCache";
import { refreshFeeds, seedCompaniesIfEmpty } from "./feeds";
import { closeTestContexts, createTestContext } from "./testSupport";

afterEach(closeTestContexts);

const ACME_BACKEND = "greenhouse:acmecloud:4012345"; // Remote - US
const ACME_ON_HN = "hn:hn:40000007"; // the same role, posted again on Hacker News
const BRIGHTPATH_PLATFORM = "lever:brightpath:7c1d0e02-3f4a-4b5c-8d6e-0000000b0002"; // New York, NY

function chooseWhereToWork(ctx: ServerContext, regions: string[]): void {
  saveProfileSection(ctx.db, "targets", { ...getProfileSection(ctx.db, "targets"), regions }, ctx.now().toISOString());
}

function shownTitles(ctx: ServerContext): string[] {
  return listUnseenJobs(ctx.db, 50).map((job) => job.title).sort();
}

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

    expect(second).toMatchObject({ added: 0, filtered: 0, duplicates: 0, restored: 0, setAside: 0 });
  });
});

describe("refreshFeeds and where the person can work", () => {
  it("with only Remote jobs chosen, keeps the remote job and leaves out the on-site ones", async () => {
    const ctx = createTestContext();
    chooseWhereToWork(ctx, ["REMOTE"]);

    const report = await refreshFeeds(ctx);

    expect(report).toMatchObject({ added: 1, filtered: 5, duplicates: 1 });
    expect(shownTitles(ctx)).toEqual(["Backend Engineer"]);
    expect(getJob(ctx.db, BRIGHTPATH_PLATFORM)?.filteredReason).toBe('The location "New York, NY" is not in a place you chose (Remote).');
  });

  it("brings back, at the next refresh, the jobs an old choice ruled out, and the repeat posting stays a duplicate", async () => {
    const ctx = createTestContext();
    chooseWhereToWork(ctx, ["IN"]);
    const first = await refreshFeeds(ctx);
    expect(first.added).toBe(0);
    expect(shownTitles(ctx)).toEqual([]);

    chooseWhereToWork(ctx, ["IN", "US"]);
    const second = await refreshFeeds(ctx);

    expect(second).toMatchObject({ added: 0, restored: 4, setAside: 0 });
    expect(shownTitles(ctx)).toEqual(["Backend Engineer", "Data Analyst", "Platform Engineer", "Software Engineer, Applied AI"]);
    expect(getJob(ctx.db, ACME_ON_HN)?.filteredReason).toContain("same role");
  });

  it("puts aside the jobs a new choice rules out, but never one that was already shown", async () => {
    const ctx = createTestContext();
    await refreshFeeds(ctx);
    markJobsSeen(ctx.db, [ACME_BACKEND], ctx.now().toISOString());

    chooseWhereToWork(ctx, ["IN"]);
    const report = await refreshFeeds(ctx);

    expect(report).toMatchObject({ restored: 0, setAside: 3 });
    expect(shownTitles(ctx)).toEqual([]);
    expect(getJob(ctx.db, ACME_BACKEND)?.filteredReason).toBeNull();
  });

  it("marks a job that comes back as a repeat of a role already shown as a duplicate, so it never shows twice", async () => {
    const ctx = createTestContext();
    await refreshFeeds(ctx);
    markJobsSeen(ctx.db, [ACME_BACKEND], ctx.now().toISOString());
    chooseWhereToWork(ctx, ["IN"]);
    await refreshFeeds(ctx);
    expect(getJob(ctx.db, ACME_ON_HN)?.filteredReason).toBe('The location "Remote (US)" is a remote job outside the places you chose (India).');

    chooseWhereToWork(ctx, ["US", "REMOTE"]);
    await refreshFeeds(ctx);

    expect(getJob(ctx.db, ACME_ON_HN)?.filteredReason).toContain("same role");
    expect(shownTitles(ctx)).not.toContain("Backend Engineer");
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
