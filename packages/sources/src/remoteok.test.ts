import { describe, expect, it } from "vitest";
import { parseRemoteOk } from "./remoteok";
import { expectUsablePosting, readRecordedFixture } from "./testSupport";

describe("parseRemoteOk", () => {
  const postings = parseRemoteOk(readRecordedFixture("remoteok.json"));

  it("returns one usable posting per job and skips the legal notice at the top", () => {
    expect(postings).toHaveLength(3);
    for (const posting of postings) {
      expectUsablePosting(posting, "remoteok");
    }
  });

  it("reads company, title, link and id of the first job", () => {
    expect(postings[0]).toMatchObject({
      jobId: "remoteok:remoteok:1137600",
      company: "Smile Digital Health",
      title: "Cloud Engineer Automation",
    });
    expect(postings[0]?.url).toContain("remote-jobs");
  });

  it("says Remote, and where the company wants people to be when the feed names a place", () => {
    expect(postings[0]?.location).toBe("Remote - Toronto, Ontario");
    expect(postings[1]?.location).toBe("Remote");
  });

  it("records the date as UTC", () => {
    expect(postings[0]?.postedAt).toBe("2026-10-29T16:00:03.000Z");
  });

  it("adds the tags so keyword matching can see them", () => {
    expect(postings[0]?.text).toMatch(/\n\nTags: .+/);
  });

  it("decodes HTML entities in titles and company names", () => {
    const body = JSON.stringify([
      { legal: "notice" },
      { id: "9", position: "Support &amp; Booking Engineer", company: "Fish &amp; Chips Ltd", description: "<p>Hi</p>", url: "https://remoteok.com/remote-jobs/9" },
    ]);

    const [posting] = parseRemoteOk(body);

    expect(posting?.title).toBe("Support & Booking Engineer");
    expect(posting?.company).toBe("Fish & Chips Ltd");
  });

  it("adds the salary only when the feed gives one", () => {
    const body = JSON.stringify([
      { legal: "notice" },
      { id: "1", position: "Engineer", company: "A", description: "x", url: "https://remoteok.com/remote-jobs/1", salary_min: 0, salary_max: 0 },
      { id: "2", position: "Engineer", company: "B", description: "x", url: "https://remoteok.com/remote-jobs/2", salary_min: 90000, salary_max: 120000 },
    ]);

    const result = parseRemoteOk(body);

    expect(result[0]?.text).not.toContain("Salary");
    expect(result[1]?.text).toContain("Salary: $90000 - $120000");
  });
});
