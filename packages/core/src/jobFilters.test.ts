import { describe, expect, it } from "vitest";
import { Profile } from "@jobgoblin/schemas";
import {
  classifyRegion,
  codeFilter,
  codeFilterTargetsFor,
  dedupeKey,
  homeRegionOf,
  isRemoteLocation,
  normalizeCompanyName,
  parseYearsExperience,
  regionName,
  yearsLimitFor,
  yearsRequired,
} from "./jobFilters";
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

describe("isRemoteLocation", () => {
  it.each([
    ["Remote - US", true],
    ["US Remote", true],
    ["us-remote", true],
    ["Remote (Canada)", true],
    ["Remote - US / Bengaluru", true],
    ["Anywhere", true],
    ["Global", true],
    ["", true],
    ["Austin, TX", false],
    ["New York, NY", false],
    ["London, United Kingdom", false],
  ] as const)("reads %j as remote: %s", (location, isRemote) => {
    expect(isRemoteLocation(location)).toBe(isRemote);
  });
});

describe("homeRegionOf", () => {
  it("reads the country of where the person lives", () => {
    expect(homeRegionOf("Austin, TX")).toBe("US");
    expect(homeRegionOf("Pune, India")).toBe("IN");
    expect(homeRegionOf("London, United Kingdom")).toBe("OTHER");
  });

  it("is null while where the person lives is missing, or when it names no place", () => {
    expect(homeRegionOf("TODO")).toBeNull();
    expect(homeRegionOf("  ")).toBeNull();
    expect(homeRegionOf("Remote")).toBeNull();
  });
});

describe("regionName", () => {
  it("gives each region code the name the screens use", () => {
    expect(["US", "IN", "REMOTE", "OTHER"].map(regionName)).toEqual(["United States", "India", "Remote", "Somewhere else"]);
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

  it("drops a role in a place outside the targets, and names the places the person chose in plain words", () => {
    const result = codeFilter(aPosting("Backend Engineer", "Bengaluru, India"), ALEX_TARGETS);

    expect(result).toEqual({
      passes: false,
      reason: 'The location "Bengaluru, India" is not in a place you chose (United States, Remote).',
    });
  });

  it("does not filter by place when the person chose none", () => {
    expect(codeFilter(aPosting("Backend Engineer", "Paris, France"), { ...ALEX_TARGETS, regions: [] }).passes).toBe(true);
  });

  it("does not drop a role just because it is not one of the person's target roles, so the run can score it", () => {
    expect(codeFilter(aPosting("Data Analyst", "San Francisco, CA"), ALEX_TARGETS).passes).toBe(true);
  });
});

describe("codeFilter, where the person can work", () => {
  function passes(location: string, regions: string[]): boolean {
    return codeFilter(aPosting("Backend Engineer", location), { ...ALEX_TARGETS, regions }).passes;
  }

  it("with only Remote jobs chosen, keeps every remote job, whatever country it names, and drops on-site jobs", () => {
    expect(passes("Remote - US", ["REMOTE"])).toBe(true);
    expect(passes("Remote (Canada)", ["REMOTE"])).toBe(true);
    expect(passes("Remote", ["REMOTE"])).toBe(true);
    expect(passes("San Francisco, CA", ["REMOTE"])).toBe(false);
    expect(passes("New York, NY", ["REMOTE"])).toBe(false);
  });

  it("with Remote jobs and a country, keeps remote jobs in that country or with no country, and not remote jobs for another one", () => {
    expect(passes("Remote - India", ["IN", "REMOTE"])).toBe(true);
    expect(passes("Remote", ["IN", "REMOTE"])).toBe(true);

    const usOnly = codeFilter(aPosting("Backend Engineer", "Remote - US"), { ...ALEX_TARGETS, regions: ["IN", "REMOTE"] });
    expect(usOnly).toEqual({
      passes: false,
      reason: 'The location "Remote - US" is a remote job outside the places you chose (India, Remote).',
    });
  });

  it("keeps a remote job in a chosen country even when Remote jobs is not chosen, but not one with no country", () => {
    expect(passes("Remote - US", ["US"])).toBe(true);
    expect(passes("Remote", ["US"])).toBe(false);
  });

  it("keeps an on-site job only in a chosen country", () => {
    expect(passes("Austin, TX", ["US"])).toBe(true);
    expect(passes("London, United Kingdom", ["OTHER"])).toBe(true);
    expect(codeFilter(aPosting("Backend Engineer", "Austin, TX"), { ...ALEX_TARGETS, regions: ["IN"] })).toEqual({
      passes: false,
      reason: 'The location "Austin, TX" is not in a place you chose (India).',
    });
  });
});

describe("codeFilter, cities the person can work from", () => {
  const inAustin = { ...ALEX_TARGETS, cities: ["Austin"] };

  it("keeps an on-site job only in a chosen city, and keeps every remote job", () => {
    expect(codeFilter(aPosting("Backend Engineer", "Austin, TX"), inAustin).passes).toBe(true);
    expect(codeFilter(aPosting("Backend Engineer", "Remote - US"), inAustin).passes).toBe(true);
    expect(codeFilter(aPosting("Backend Engineer", "New York, NY"), inAustin)).toEqual({
      passes: false,
      reason: 'The location "New York, NY" is not in a city you chose (Austin).',
    });
  });

  it("keeps an on-site job in a chosen city even when only Remote jobs is chosen as a place", () => {
    const remoteAndAustin = { ...inAustin, regions: ["REMOTE"] };

    expect(codeFilter(aPosting("Backend Engineer", "Austin, TX"), remoteAndAustin).passes).toBe(true);
    expect(codeFilter(aPosting("Backend Engineer", "Seattle, WA"), remoteAndAustin).passes).toBe(false);
  });

  it("matches a city as whole words only, and ignores empty lines", () => {
    expect(codeFilter(aPosting("Backend Engineer", "Austinville, TX"), inAustin).passes).toBe(false);
    expect(codeFilter(aPosting("Backend Engineer", "New York, NY"), { ...ALEX_TARGETS, cities: ["  ", ""] }).passes).toBe(true);
  });
});

describe("the years limit follows the person's experience", () => {
  function withYears(yearsExperience: string, maxYearsRequired = 4): Profile {
    const alex = alexRiveraProfile();
    return Profile.parse({ ...alex, employment: { ...alex.employment, yearsExperience }, targets: { ...alex.targets, maxYearsRequired } });
  }

  it("allows two years more than the person has", () => {
    expect(yearsLimitFor(alexRiveraProfile())).toEqual({ limit: 4, experience: 2 }); // Alex has 2 years
    expect(yearsLimitFor(withYears("5"))).toEqual({ limit: 7, experience: 5 });
  });

  it.each([
    ["3 years", 3],
    ["5+", 5],
    ["1.5", 1],
    ["TODO", null],
    ["a few", null],
  ] as const)("reads the years in the answer %j as %s", (answer, years) => {
    expect(parseYearsExperience(answer)).toBe(years);
  });

  it("uses the stored limit while the years of experience are missing", () => {
    expect(yearsLimitFor(withYears("TODO", 6))).toEqual({ limit: 6, experience: null });
  });

  it("gives the code filter the person's places, cities, roles to avoid and the years limit", () => {
    const targets = codeFilterTargetsFor(withYears("5"));
    const askingSeven = aPosting("Backend Engineer", "Remote - US", "Requirements:\n7+ years of experience with Python.");
    const askingEight = aPosting("Backend Engineer", "Remote - US", "Requirements:\n8+ years of experience with Python.");

    expect(targets).toEqual({ rolesToAvoid: ALEX_TARGETS.rolesToAvoid, regions: ["US", "REMOTE"], cities: [], maxYearsRequired: 7 });
    expect(codeFilter(askingSeven, targets).passes).toBe(true);
    expect(codeFilter(askingEight, targets)).toEqual({
      passes: false,
      reason: "It asks for 8 years of experience, and your limit is 7.",
    });
  });
});
