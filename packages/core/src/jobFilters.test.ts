import { describe, expect, it } from "vitest";
import { classifyRegion, codeFilter, dedupeKey, normalizeCompanyName, yearsRequired } from "./jobFilters";
import { alexRiveraProfile } from "./testing/alexRivera";

const ALEX_TARGETS = alexRiveraProfile().targets;

function aPosting(title: string, location = "Remote - US", text = "Build backend services in Python."): {
  title: string;
  location: string;
  text: string;
} {
  return { title, location, text };
}

describe("classifyRegion", () => {
  it.each([
    ["Remote - US", "US"],
    ["Remote (US)", "US"],
    ["Remote, US", "US"],
    ["US Remote", "US"],
    ["United States", "US"],
    ["Austin, TX", "US"],
    ["New York, NY", "US"],
    ["San Francisco Bay Area", "US"],
    ["Remote - Americas", "US"],
    ["Thousand Oaks, CA", "US"],
    ["Bengaluru, Karnataka", "IN"],
    ["Hyderabad, India", "IN"],
    ["Remote - India", "IN"],
    ["Remote", "REMOTE"],
    ["Anywhere", "REMOTE"],
    ["Remote - Worldwide", "REMOTE"],
    ["Remote (Global)", "REMOTE"],
    ["", "REMOTE"],
    ["London, United Kingdom", "OTHER"],
    ["Remote (Canada)", "OTHER"],
    ["Paris, France", "OTHER"],
  ] as const)("reads %j as %s", (location, region) => {
    expect(classifyRegion(location)).toBe(region);
  });

  it("does not read the letters usa inside another word as the US", () => {
    expect(classifyRegion("Mousa, Lebanon")).toBe("OTHER");
  });

  it("reads a place in India before a US word, as the prototype did", () => {
    expect(classifyRegion("Remote - US / Bengaluru")).toBe("IN");
  });
});

describe("dedupeKey", () => {
  it('is the same for "Remote - US" and "Remote (US)" at the same company and title', () => {
    const onGreenhouse = dedupeKey("Acme Cloud", "Backend Engineer", "Remote - US");
    const onHackerNews = dedupeKey("Acme Cloud", "Backend Engineer", "Remote (US)");

    expect(onHackerNews).toBe(onGreenhouse);
  });

  it("ignores case, punctuation, legal endings and the order of place words", () => {
    const reference = dedupeKey("Acme Cloud", "Backend Engineer", "Remote - US");

    expect(dedupeKey("ACME CLOUD, Inc.", "backend  engineer", "US Remote")).toBe(reference);
    expect(dedupeKey("Acme Cloud", "Backend Engineer", "Remote - United States")).toBe(reference);
  });

  it("differs for another company, title or place", () => {
    const reference = dedupeKey("Acme Cloud", "Backend Engineer", "Remote - US");

    expect(dedupeKey("Brightpath", "Backend Engineer", "Remote - US")).not.toBe(reference);
    expect(dedupeKey("Acme Cloud", "Platform Engineer", "Remote - US")).not.toBe(reference);
    expect(dedupeKey("Acme Cloud", "Backend Engineer", "New York, NY")).not.toBe(reference);
  });

  it("is a SHA-256 in lowercase hex", () => {
    expect(dedupeKey("a", "b", "c")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("normalizeCompanyName", () => {
  it("makes spellings of one company equal", () => {
    expect(normalizeCompanyName("Acme Cloud, Inc.")).toBe("acme cloud");
    expect(normalizeCompanyName("ACME  CLOUD LLC")).toBe("acme cloud");
  });

  it("keeps a name that is only a legal ending", () => {
    expect(normalizeCompanyName("Co")).toBe("co");
  });
});

describe("yearsRequired", () => {
  it.each([
    ["5+ years of experience building distributed systems", 5],
    ["3 years of professional experience", 3],
    ["Minimum of 4 yrs experience with Python", 4],
    ["You have 3-5 years of experience", 3],
    ["At least 2 to 4 years of experience", 2],
    ["5 plus years of experience", 5],
  ])("reads %j as %i", (sentence, years) => {
    expect(yearsRequired("Engineer", sentence)).toBe(years);
  });

  it("takes the most the posting asks for", () => {
    expect(yearsRequired("Engineer", "3+ years of experience in Go.\nAlso 6+ years of experience overall.")).toBe(6);
  });

  it("reads years in the title without needing the word experience", () => {
    expect(yearsRequired("Senior Staff Engineer (8+ years)", "")).toBe(8);
  });

  it("ignores a years phrase in a sentence that is not about experience", () => {
    expect(yearsRequired("Engineer", "We have been in business for 10 years. Join our team.")).toBeNull();
  });

  it("ignores a sentence where the company speaks about itself, unless it says who it wants", () => {
    const aboutTheCompany = "We have 10 years of experience in logistics. You need 3+ years of experience with Python.";
    const aboutTheCandidate = "We are looking for someone with 6 years of experience.";

    expect(yearsRequired("Engineer", aboutTheCompany)).toBe(3);
    expect(yearsRequired("Engineer", aboutTheCandidate)).toBe(6);
  });

  it("ignores very large numbers, which are about a company's history", () => {
    expect(yearsRequired("Engineer", "With 40 years of experience serving customers, we are growing.")).toBeNull();
    expect(yearsRequired("Engineer", "Over 100 years of experience in logistics.")).toBeNull();
  });

  it("returns null when the posting does not say", () => {
    expect(yearsRequired("Backend Engineer", "Build services. Work with Python and Postgres.")).toBeNull();
  });
});

describe("codeFilter, with Alex Rivera's targets", () => {
  it("passes a backend role in the US", () => {
    expect(codeFilter(aPosting("Backend Engineer"), ALEX_TARGETS)).toEqual({ passes: true });
  });

  it("passes a platform role in New York and a role in a remote-anywhere location", () => {
    expect(codeFilter(aPosting("Platform Engineer", "New York, NY"), ALEX_TARGETS).passes).toBe(true);
    expect(codeFilter(aPosting("Software Engineer", "Remote - Worldwide"), ALEX_TARGETS).passes).toBe(true);
  });

  it('drops "QA Automation Engineer" because the person avoids QA roles', () => {
    const result = codeFilter(aPosting("QA Automation Engineer"), ALEX_TARGETS);

    expect(result).toEqual({ passes: false, reason: expect.stringContaining('"QA"') });
  });

  it.each(["Senior SDET", "Software Test Engineer", "Quality Engineer II", "qa engineer"])("drops the avoided role %j", (title) => {
    expect(codeFilter(aPosting(title), ALEX_TARGETS).passes).toBe(false);
  });

  it("does not drop a title that only contains the letters of an avoided role", () => {
    expect(codeFilter(aPosting("Backend Engineer, Latest Products"), ALEX_TARGETS).passes).toBe(true);
  });

  it('drops "Senior Staff Engineer (8+ years)" because it asks for more years than the limit', () => {
    const result = codeFilter(aPosting("Senior Staff Engineer (8+ years)", "New York, NY"), ALEX_TARGETS);

    expect(result).toEqual({ passes: false, reason: expect.stringContaining("8 years") });
  });

  it("drops a posting whose body asks for more than 4 years, and keeps one that asks for exactly 4", () => {
    const fiveYears = aPosting("Backend Engineer", "Remote - US", "Requirements:\n5+ years of experience with Python.");
    const fourYears = aPosting("Backend Engineer", "Remote - US", "Requirements:\n4+ years of experience with Python.");

    expect(codeFilter(fiveYears, ALEX_TARGETS).passes).toBe(false);
    expect(codeFilter(fourYears, ALEX_TARGETS).passes).toBe(true);
  });

  it("uses the person's own limit", () => {
    const fiveYears = aPosting("Backend Engineer", "Remote - US", "5+ years of experience.");

    expect(codeFilter(fiveYears, { ...ALEX_TARGETS, maxYearsRequired: 6 }).passes).toBe(true);
  });

  it("drops a role in a region outside the targets, and says which regions the person chose", () => {
    const result = codeFilter(aPosting("Backend Engineer", "Bengaluru, India"), ALEX_TARGETS);

    expect(result).toEqual({ passes: false, reason: expect.stringContaining("US, REMOTE") });
  });

  it("does not filter by region when the person chose none", () => {
    expect(codeFilter(aPosting("Backend Engineer", "Paris, France"), { ...ALEX_TARGETS, regions: [] }).passes).toBe(true);
  });

  it("does not drop a role just because it is not one of the person's target roles, so the run can score it", () => {
    expect(codeFilter(aPosting("Data Analyst", "San Francisco, CA"), ALEX_TARGETS).passes).toBe(true);
  });
});
