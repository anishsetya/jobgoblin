import { describe, expect, it } from "vitest";
import { expectUsablePosting, readRecordedFixture } from "./testSupport";
import { parseYcPage } from "./yc";

describe("parseYcPage", () => {
  const postings = parseYcPage(readRecordedFixture("yc-software-engineer.html"));

  it("returns one usable posting per job on the page", () => {
    expect(postings).toHaveLength(3);
    for (const posting of postings) {
      expectUsablePosting(posting, "yc");
    }
  });

  it("links to the public posting on ycombinator.com, not the login-only apply page", () => {
    expect(postings[0]?.url).toMatch(/^https:\/\/www\.ycombinator\.com\/companies\/.+\/jobs\//);
    expect(postings[0]?.jobId).toMatch(/^yc:yc:\d+$/);
  });

  it("builds the text from the company one-liner and the role's basics", () => {
    const text = postings[0]?.text ?? "";

    expect(text).toContain("Experience:");
    expect(text).toContain("Visa:");
  });

  it("leaves the date empty, because the page only says things like 4 months", () => {
    expect(postings[0]?.postedAt).toBeNull();
  });

  it("explains when the page layout has changed", () => {
    expect(() => parseYcPage("<html><body>No data here</body></html>")).toThrow("no data-page attribute");
  });
});
