import { describe, expect, it } from "vitest";
import { greenhouseBoardUrl, greenhouseJobUrl, parseGreenhouseBoard, parseGreenhouseJob } from "./greenhouse";
import { expectUsablePosting, readRecordedFixture } from "./testSupport";

const ANTHROPIC = { slug: "anthropic", companyName: "Anthropic" };

describe("parseGreenhouseBoard", () => {
  const postings = parseGreenhouseBoard(readRecordedFixture("greenhouse-board.json"), ANTHROPIC);

  it("returns one usable posting per job on the board", () => {
    expect(postings).toHaveLength(3);
    for (const posting of postings) {
      expectUsablePosting(posting, "greenhouse");
    }
  });

  it("reads company, title, location, link and id of the first job", () => {
    expect(postings[0]).toMatchObject({
      jobId: "greenhouse:anthropic:5455961008",
      company: "Anthropic",
      title: "Applied AI Demo Engineer",
      location: "San Francisco, CA | New York City, NY",
      url: "https://job-boards.greenhouse.io/anthropic/jobs/5455961008",
    });
  });

  it("turns the escaped HTML description into readable text", () => {
    expect(postings[0]?.text).toContain("About Anthropic");
    expect(postings[0]?.text).toContain("\n\n");
  });

  it("records the publication date as UTC", () => {
    expect(postings[0]?.postedAt).toMatch(/^2026-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  });

  it("leaves questions empty, because the board list does not carry them", () => {
    expect(postings[0]?.questions).toEqual([]);
  });

  it("uses the company's own name from the feed when none is given", () => {
    const unnamed = parseGreenhouseBoard(readRecordedFixture("greenhouse-board.json"), { slug: "anthropic", companyName: null });

    expect(unnamed[0]?.company).toBe("Anthropic");
  });

  it("skips entries that have no id or no title", () => {
    const body = JSON.stringify({ jobs: [{ title: "No id" }, { id: 1 }, "junk", { id: 2, title: "Real", content: "" }] });

    const result = parseGreenhouseBoard(body, ANTHROPIC);

    expect(result.map((posting) => posting.jobId)).toEqual(["greenhouse:anthropic:2"]);
  });

  it("refuses a response that is not JSON", () => {
    expect(() => parseGreenhouseBoard("<html>Maintenance</html>", ANTHROPIC)).toThrow("was not valid JSON");
  });
});

describe("parseGreenhouseJob", () => {
  const posting = parseGreenhouseJob(readRecordedFixture("greenhouse-job.json"), ANTHROPIC);

  it("returns the job as a usable posting", () => {
    expect(posting).not.toBeNull();
    expectUsablePosting(posting!, "greenhouse");
  });

  it("keeps the company's screening questions and drops Greenhouse's own form fields", () => {
    const questions = posting!.questions;

    expect(questions).toContain("Why Anthropic?: Why do you want to work at Anthropic? (We value this response highly - great answers are often 200-400 words.)");
    expect(questions).toContain("Do you require visa sponsorship?");
    expect(questions).not.toContain("First Name");
    expect(questions).not.toContain("Email");
    expect(questions).not.toContain("Resume/CV");
  });

  it("puts the real question after the label when the label is only a heading", () => {
    expect(posting!.questions).toContain("(Optional) Personal Preferences: How do you pronounce your name?");
  });
});

describe("Greenhouse addresses", () => {
  it("asks the board for descriptions", () => {
    expect(greenhouseBoardUrl("acmecloud")).toBe("https://boards-api.greenhouse.io/v1/boards/acmecloud/jobs?content=true");
  });

  it("asks a single job for its questions", () => {
    expect(greenhouseJobUrl("gridline", "4100")).toBe("https://boards-api.greenhouse.io/v1/boards/gridline/jobs/4100?questions=true");
  });
});
