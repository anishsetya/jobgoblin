import { afterEach, describe, expect, it } from "vitest";
import { getProfile, updateProfileSection } from "./profile";
import { getProfileForRun, saveProfileSectionFromRun } from "./profileForRuns";
import { closeTestContexts, createTestContext } from "./testSupport";

afterEach(closeTestContexts);

describe("getProfile", () => {
  it("lists the values Alex still has to fill in", () => {
    const ctx = createTestContext();

    expect(getProfile(ctx).missing).toEqual([{ section: "compensation", key: "expectedBase", label: "Expected base salary" }]);
  });

  it("lists everything for a fresh profile, including the US work authorization answers", () => {
    const ctx = createTestContext({ withAlexRivera: false });

    const keys = getProfile(ctx).missing.map((value) => `${value.section}.${value.key}`);

    expect(keys).toEqual(
      expect.arrayContaining([
        "contact.fullName",
        "contact.phone",
        "workAuthorization.regions.US.authorized",
        "employment.noticePeriod",
        "compensation.expectedBase",
      ]),
    );
  });
});

describe("updateProfileSection", () => {
  it("saves the section, tells the dashboard, and returns the profile again", () => {
    const ctx = createTestContext();
    const events: string[] = [];
    ctx.bus.subscribe((event) => events.push(event.type));

    const response = updateProfileSection(ctx, "compensation", { expectedBase: "$120,000" });

    expect(response.profile.compensation.expectedBase).toBe("$120,000");
    expect(response.missing).toEqual([]);
    expect(events).toContain("profile.updated");
  });
});

describe("getProfileForRun", () => {
  it("shows work authorization, employment, targets and banned words, and nothing personal", () => {
    const ctx = createTestContext();

    const profile = getProfileForRun(ctx);

    expect(profile.facts.employment.noticePeriod).toBe("2 weeks");
    expect(profile.targets.roles).toContain("Backend Engineer");
    expect(profile.rules.bannedTerms).toEqual(["rockstar", "ninja"]);
    // The expected salary is missing, but that is a personal value: a run is not told about it either.
    expect(profile.missing).toEqual([]);
    const everything = JSON.stringify(profile);
    for (const secret of ["alex.rivera@example.com", "555 0100", "Alex Rivera", "Decline to self-identify"]) {
      expect(everything).not.toContain(secret);
    }
  });
});

describe("saveProfileSectionFromRun", () => {
  it("fills a value that is still TODO and reports which", () => {
    const ctx = createTestContext({ withAlexRivera: false });

    const outcome = saveProfileSectionFromRun(ctx, { section: "employment", data: { yearsExperience: "2", currentEmployer: "Northwind" } });

    expect(outcome).toEqual({ ok: true, value: { section: "employment", filledKeys: ["yearsExperience", "currentEmployer"] } });
    expect(getProfile(ctx).profile.employment).toMatchObject({ yearsExperience: "2", currentEmployer: "Northwind" });
  });

  it("never overwrites a value the person typed", () => {
    const ctx = createTestContext();

    const outcome = saveProfileSectionFromRun(ctx, { section: "employment", data: { noticePeriod: "1 day", currentTitle: "CEO" } });

    expect(outcome).toEqual({ ok: true, value: { section: "employment", filledKeys: [] } });
    expect(getProfile(ctx).profile.employment).toMatchObject({ noticePeriod: "2 weeks", currentTitle: "Software Engineer" });
  });

  it("fills a region's answers without touching the ones already set", () => {
    const ctx = createTestContext();

    const outcome = saveProfileSectionFromRun(ctx, {
      section: "workAuthorization",
      data: { regions: { US: { authorized: false, willingToRelocate: false }, IN: { authorized: true, requiresSponsorship: false } } },
    });

    expect(outcome.ok).toBe(true);
    const regions = getProfile(ctx).profile.workAuthorization.regions;
    expect(regions.US).toEqual({ authorized: true, requiresSponsorship: false, willingToRelocate: true });
    expect(regions.IN).toMatchObject({ authorized: true, requiresSponsorship: false, willingToRelocate: "TODO" });
  });

  it("fills empty lists in the targets but keeps the ones that already have something", () => {
    const ctx = createTestContext({ withAlexRivera: false });

    const outcome = saveProfileSectionFromRun(ctx, {
      section: "targets",
      data: { roles: ["Backend Engineer"], hardSkips: ["Everything"] },
    });

    expect(outcome).toMatchObject({ ok: true, value: { filledKeys: ["roles"] } });
    const targets = getProfile(ctx).profile.targets;
    expect(targets.roles).toEqual(["Backend Engineer"]);
    expect(targets.hardSkips).toEqual(["An active security clearance is required"]);
  });

  it("returns a value of the wrong kind as an error", () => {
    const ctx = createTestContext({ withAlexRivera: false });

    const outcome = saveProfileSectionFromRun(ctx, { section: "employment", data: { yearsExperience: 2 } });

    expect(outcome).toMatchObject({ ok: false, errors: [{ code: "schema" }] });
  });
});
