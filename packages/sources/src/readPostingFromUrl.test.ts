import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { greenhouseJobUrl } from "./greenhouse";
import { createMemoryFeedCache } from "./memoryFeedCache";
import { readPostingFromUrl } from "./readPostingFromUrl";
import { DEMO_FEEDS_DIR, expectUsablePosting, readRecordedFixture } from "./testSupport";

const fetchMustNotBeCalled = vi.fn(() => Promise.reject(new Error("The network must not be used.")));

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMustNotBeCalled);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMustNotBeCalled.mockClear();
});

const demo = { cache: createMemoryFeedCache(), fixturesDir: DEMO_FEEDS_DIR };

describe("readPostingFromUrl with saved files", () => {
  it("serves the pasted Gridline Energy job from the demo fixtures", async () => {
    const result = await readPostingFromUrl("https://boards.greenhouse.io/gridline/jobs/4100", demo);

    expect(result.kind).toBe("posting");
    if (result.kind !== "posting") {
      return;
    }
    expectUsablePosting(result.posting, "greenhouse");
    expect(result.posting).toMatchObject({
      jobId: "greenhouse:gridline:4100",
      company: "Gridline Energy",
      title: "Backend Engineer",
      location: "Remote - US",
    });
    expect(result.posting.text).toContain("PostgreSQL");
  });

  it("includes the job's own application questions but not the standard form fields", async () => {
    const result = await readPostingFromUrl("https://boards.greenhouse.io/gridline/jobs/4100", demo);

    expect(result.kind === "posting" && result.posting.questions).toEqual([
      "LinkedIn Profile",
      "Are you legally authorized to work in the United States?",
      "Will you now or in the future require sponsorship for employment visa status?",
      "Why Gridline?: In a few sentences, tell us what draws you to energy software.",
    ]);
  });

  it("reads a demo job from a Lever link and from an Ashby link", async () => {
    const lever = await readPostingFromUrl("https://jobs.lever.co/brightpath/7c1d0e02-3f4a-4b5c-8d6e-0000000b0002", demo);
    const ashby = await readPostingFromUrl("https://jobs.ashbyhq.com/copperleaf/9a8b7c03-1d2e-4f3a-8b4c-0000000c0003", demo);

    expect(lever.kind === "posting" && lever.posting.jobId).toBe("lever:brightpath:7c1d0e02-3f4a-4b5c-8d6e-0000000b0002");
    expect(ashby.kind === "posting" && ashby.posting.title).toBe("Software Engineer, Applied AI");
  });

  it("says unreadable for a recognized link whose posting has no saved file", async () => {
    const result = await readPostingFromUrl("https://boards.greenhouse.io/gridline/jobs/9999", demo);

    expect(result).toEqual({ kind: "needs-text", reason: "unreadable" });
  });

  it("never touches the network", async () => {
    await readPostingFromUrl("https://boards.greenhouse.io/gridline/jobs/4100", demo);
    await readPostingFromUrl("https://boards.greenhouse.io/gridline/jobs/9999", demo);

    expect(fetchMustNotBeCalled).not.toHaveBeenCalled();
  });
});

describe("readPostingFromUrl for links it cannot read", () => {
  it.each([
    "https://www.linkedin.com/jobs/view/3912345678",
    "https://wellfound.com/jobs/12345-backend-engineer",
    "https://www.workatastartup.com/jobs/54321",
    "https://www.welcometothejungle.com/en/companies/acme/jobs/backend-engineer",
    "https://www.instahyre.com/job-123456-backend-engineer-at-acme/",
    "https://cutshort.io/job/Backend-Engineer-Acme-abc123",
    "https://www.indeed.com/viewjob?jk=abcdef0123456789",
  ])("asks for the text of the login-only link %s, without fetching it", async (link) => {
    const result = await readPostingFromUrl(link, { cache: createMemoryFeedCache(), fixturesDir: null });

    expect(result).toEqual({ kind: "needs-text", reason: "login-only" });
    expect(fetchMustNotBeCalled).not.toHaveBeenCalled();
  });

  it.each(["https://example.com/careers/backend-engineer", "not a link"])(
    "says %s is unreadable, without fetching it",
    async (link) => {
      const result = await readPostingFromUrl(link, { cache: createMemoryFeedCache(), fixturesDir: null });

      expect(result).toEqual({ kind: "needs-text", reason: "unreadable" });
      expect(fetchMustNotBeCalled).not.toHaveBeenCalled();
    },
  );
});

describe("readPostingFromUrl over the network", () => {
  it("reads a public link through the cache, so a fresh saved copy needs no request", async () => {
    const cache = createMemoryFeedCache();
    cache.write(greenhouseJobUrl("anthropic", "5456619008"), {
      etag: null,
      lastModified: null,
      body: readRecordedFixture("greenhouse-job.json"),
      fetchedAt: new Date().toISOString(),
    });

    const result = await readPostingFromUrl("https://job-boards.greenhouse.io/anthropic/jobs/5456619008", { cache, fixturesDir: null });

    expect(result.kind).toBe("posting");
    expect(fetchMustNotBeCalled).not.toHaveBeenCalled();
  });

  it("treats a download that fails as unreadable", async () => {
    const result = await readPostingFromUrl("https://boards.greenhouse.io/gridline/jobs/4100", {
      cache: createMemoryFeedCache(),
      fixturesDir: null,
    });

    expect(fetchMustNotBeCalled).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: "needs-text", reason: "unreadable" });
  });
});
