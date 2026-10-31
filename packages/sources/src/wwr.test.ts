import { describe, expect, it } from "vitest";
import { readRssItems, readXmlText } from "./rss";
import { expectUsablePosting, readRecordedFixture } from "./testSupport";
import { parseWwrFeed, wwrCategoryUrl } from "./wwr";

describe("parseWwrFeed", () => {
  const postings = parseWwrFeed(readRecordedFixture("wwr-back-end.xml"));

  it("returns one usable posting per item", () => {
    expect(postings).toHaveLength(3);
    for (const posting of postings) {
      expectUsablePosting(posting, "wwr");
    }
  });

  it("splits the title into company and role at the first colon", () => {
    expect(postings[0]).toMatchObject({
      jobId: "wwr:wwr:dropbox-backend-product-software-engineer-1",
      company: "Dropbox",
      title: "Backend Product Software Engineer",
      url: "https://weworkremotely.com/remote-jobs/dropbox-backend-product-software-engineer-1",
    });
  });

  it("decodes XML escapes in the title", () => {
    expect(postings[1]?.title).toBe("Backend / Platform Developer Consultant (Temporal & Kubernetes)");
  });

  it("says Remote and keeps the region the feed gives", () => {
    expect(postings[0]?.location).toBe("Remote - Anywhere in the World");
  });

  it("turns the escaped HTML description into readable text", () => {
    expect(postings[0]?.text).toContain("Role Description");
    expect(postings[0]?.text).toContain("\n\n");
  });

  it("records the publication date as UTC", () => {
    expect(postings[0]?.postedAt).toBe("2026-10-31T07:31:12.000Z");
  });
});

describe("the RSS reader", () => {
  it("finds every item in a feed", () => {
    const xml = "<rss><channel><title>Feed</title><item><title>A</title></item><item><title>B</title></item></channel></rss>";

    expect(readRssItems(xml).map((item) => readXmlText(item, "title"))).toEqual(["A", "B"]);
  });

  it("reads CDATA as it is, without decoding it again", () => {
    const item = "<description><![CDATA[<p>Fish &amp; chips</p>]]></description>";

    expect(readXmlText(item, "description")).toBe("<p>Fish &amp; chips</p>");
  });

  it("returns an empty string for a missing or empty tag", () => {
    expect(readXmlText("<country></country>", "country")).toBe("");
    expect(readXmlText("<title>x</title>", "state")).toBe("");
  });

  it("builds a posting from an item whose description is CDATA", () => {
    const xml = `<rss><channel><item>
      <title>Acme: Engineer</title>
      <link>https://weworkremotely.com/remote-jobs/acme-engineer</link>
      <description><![CDATA[<p>Build <b>things</b>.</p>]]></description>
    </item></channel></rss>`;

    const [posting] = parseWwrFeed(xml);

    expect(posting?.text).toBe("Build things.");
    expect(posting?.location).toBe("Remote");
  });
});

describe("We Work Remotely addresses", () => {
  it("reads one feed per category", () => {
    expect(wwrCategoryUrl("remote-devops-sysadmin-jobs")).toBe("https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss");
  });
});
