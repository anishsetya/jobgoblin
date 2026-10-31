import { describe, expect, it } from "vitest";
import { findHiringThreadId, hnThreadUrl, parseHnThread } from "./hn";
import { expectUsablePosting, readRecordedFixture } from "./testSupport";

describe("findHiringThreadId", () => {
  it("picks the Who is hiring thread, not the Who wants to be hired one", () => {
    expect(findHiringThreadId(readRecordedFixture("hn-search.json"))).toBe("49922569");
  });

  it("explains when there is no such thread", () => {
    expect(() => findHiringThreadId('{"hits":[]}')).toThrow("No \"Who is hiring?\" thread");
  });
});

describe("parseHnThread", () => {
  const postings = parseHnThread(readRecordedFixture("hn-thread.json"));

  it("returns one usable posting per top-level comment and ignores replies", () => {
    expect(postings).toHaveLength(3);
    for (const posting of postings) {
      expectUsablePosting(posting, "hn");
    }
  });

  it("links each posting to its comment on Hacker News", () => {
    expect(postings[0]).toMatchObject({
      jobId: "hn:hn:49922584",
      url: "https://news.ycombinator.com/item?id=49922584",
      postedAt: "2026-10-01T15:02:37.000Z",
    });
  });

  it("reads a header that uses spaced dashes and a bracketed location", () => {
    expect(postings[0]).toMatchObject({
      company: "PrairieLearn",
      title: "Full-Stack Software Engineer",
      location: "Remote US",
    });
  });

  it("reads a header that uses bars, and keeps the whole header as the title when no role is named", () => {
    expect(postings[1]).toMatchObject({
      company: "Shepherd",
      title: "Shepherd (Series B) | ONSITE | San Francisco, CA & New York City, NY",
      location: "ONSITE / San Francisco, CA & New York City, NY",
    });
  });

  it("keeps the role and the location apart from pay and employment type", () => {
    expect(postings[2]).toMatchObject({
      company: "Sidekick Labs",
      title: "Senior SWE, R&D Engineer, Intelligence Engineer",
      location: "REMOTE (US Timezones)",
    });
  });

  it("decodes the comment's HTML into text with paragraph breaks", () => {
    expect(postings[0]?.text).toContain("\n\n");
    expect(postings[0]?.text).toContain("https://www.prairielearn.com");
  });

  it("skips deleted comments", () => {
    const body = JSON.stringify({ children: [{ id: 1, text: null }, { id: 2, text: "Acme | Engineer | Remote", created_at: "2026-10-01T00:00:00.000Z" }] });

    expect(parseHnThread(body).map((posting) => posting.jobId)).toEqual(["hn:hn:2"]);
  });
});

describe("Hacker News addresses", () => {
  it("reads a thread through the items endpoint", () => {
    expect(hnThreadUrl("49922569")).toBe("https://hn.algolia.com/api/v1/items/49922569");
  });
});
