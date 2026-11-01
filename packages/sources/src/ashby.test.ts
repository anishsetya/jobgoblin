import { describe, expect, it } from "vitest";
import { parseAshbyBoard } from "./ashby";
import { expectUsablePosting, readRecordedFixture } from "./testSupport";

const SIERRA = { slug: "sierra", companyName: "Sierra" };

describe("parseAshbyBoard", () => {
  const postings = parseAshbyBoard(readRecordedFixture("ashby-board.json"), SIERRA);

  it("returns one usable posting per listed job", () => {
    expect(postings).toHaveLength(3);
    for (const posting of postings) {
      expectUsablePosting(posting, "ashby");
    }
  });

  it("reads company, title, location, link and id of the first job", () => {
    expect(postings[0]).toMatchObject({
      jobId: "ashby:sierra:d77487f9-bab3-44c6-be18-744e7125c8b3",
      company: "Sierra",
      title: "Software Engineer, Platform",
      location: "San Francisco, CA",
      url: "https://jobs.ashbyhq.com/sierra/d77487f9-bab3-44c6-be18-744e7125c8b3",
    });
  });

  it("records the publication date as UTC", () => {
    expect(postings[0]?.postedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  });

  it("has no questions, because Ashby does not publish them", () => {
    expect(postings[0]?.questions).toEqual([]);
  });

  it("skips jobs Ashby marks as not listed", () => {
    const body = JSON.stringify({
      jobs: [
        { id: "a", title: "Hidden role", isListed: false, jobUrl: "https://jobs.ashbyhq.com/x/a", descriptionPlain: "x" },
        { id: "b", title: "Open role", isListed: true, jobUrl: "https://jobs.ashbyhq.com/x/b", descriptionPlain: "x" },
      ],
    });

    const result = parseAshbyBoard(body, { slug: "x", companyName: "X" });

    expect(result.map((posting) => posting.title)).toEqual(["Open role"]);
  });

  it("lists every location once, adds the remote note, and appends the pay summary", () => {
    const body = JSON.stringify({
      jobs: [
        {
          id: "c",
          title: "Engineer",
          location: "Austin, TX",
          secondaryLocations: [{ location: "Denver, CO" }, { location: "Austin, TX" }],
          isRemote: true,
          jobUrl: "https://jobs.ashbyhq.com/x/c",
          descriptionPlain: "Build things.",
          compensation: { compensationTierSummary: "$140K - $170K" },
        },
      ],
    });

    const [posting] = parseAshbyBoard(body, { slug: "x", companyName: "X" });

    expect(posting?.location).toBe("Austin, TX / Denver, CO (Remote)");
    expect(posting?.text).toBe("Build things.\n\nCompensation: $140K - $170K");
  });

  it("refuses a response that is not an object", () => {
    expect(() => parseAshbyBoard("[]", SIERRA)).toThrow("was not a JSON object");
  });
});
