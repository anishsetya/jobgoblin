import { describe, expect, it } from "vitest";
import { parseLeverBoard, parseLeverPosting } from "./lever";
import { expectUsablePosting, readRecordedFixture } from "./testSupport";

const PALANTIR = { slug: "palantir", companyName: "Palantir" };

describe("parseLeverBoard", () => {
  const postings = parseLeverBoard(readRecordedFixture("lever-board.json"), PALANTIR);

  it("returns one usable posting per entry", () => {
    expect(postings).toHaveLength(3);
    for (const posting of postings) {
      expectUsablePosting(posting, "lever");
    }
  });

  it("reads company, title, location, link and id", () => {
    expect(postings[1]).toMatchObject({
      jobId: "lever:palantir:10dfc8bc-99ad-4ca2-ab76-853cb90a92c2",
      company: "Palantir",
      title: "Backend Software Engineer - Application Development",
      location: "London, United Kingdom",
      url: "https://jobs.lever.co/palantir/10dfc8bc-99ad-4ca2-ab76-853cb90a92c2",
    });
  });

  it("says so when the feed marks a posting remote but the location does not", () => {
    expect(postings[0]?.location).toBe("North America (Remote)");
  });

  it("builds the text from the intro, each named list, and the closing note", () => {
    const text = postings[1]?.text ?? "";

    expect(text).toContain("A World-Changing Company");
    expect(text).toMatch(/\n\n.+\n- /); // a list heading followed by dash-prefixed items
  });

  it("turns Lever's epoch milliseconds into a UTC date", () => {
    const createdAt = (JSON.parse(readRecordedFixture("lever-board.json")) as { createdAt: number }[])[0]?.createdAt;

    expect(postings[0]?.postedAt).toBe(new Date(createdAt ?? 0).toISOString());
    expect(postings[0]?.postedAt).toMatch(/Z$/);
  });

  it("has no questions, because Lever does not publish them", () => {
    expect(postings[0]?.questions).toEqual([]);
  });

  it("refuses a response that is not a list", () => {
    expect(() => parseLeverBoard('{"ok":false}', PALANTIR)).toThrow("was not a JSON list");
  });
});

describe("parseLeverPosting", () => {
  it("reads one posting, naming the company from the slug when nothing better is known", () => {
    const posting = parseLeverPosting(readRecordedFixture("lever-posting.json"), { slug: "palantir", companyName: null });

    expect(posting).not.toBeNull();
    expectUsablePosting(posting!, "lever");
    expect(posting!.company).toBe("Palantir");
  });
});
