import { afterEach, describe, expect, it } from "vitest";
import type { Profile } from "@jobgoblin/schemas";
import type { ServerContext } from "../context";
import { getProfile, updateProfileSection } from "./profile";
import { getProfileForRun, saveProfileSectionFromRun } from "./profileForRuns";
import { closeTestContexts, createTestContext } from "./testSupport";

afterEach(closeTestContexts);

function chooseWhereToWork(ctx: ServerContext, regions: string[]): void {
  updateProfileSection(ctx, "targets", { ...getProfile(ctx).profile.targets, regions });
}

function moveTo(ctx: ServerContext, location: string): void {
  updateProfileSection(ctx, "contact", { ...getProfile(ctx).profile.contact, location });
}

function labelsOfMissing(ctx: ServerContext): string[] {
  return getProfile(ctx).missing.map((value) => value.label);
}

describe("getProfile", () => {
  it("lists the values Alex still has to fill in", () => {
    const ctx = createTestContext();

    expect(getProfile(ctx).missing).toEqual([{ section: "compensation", key: "expectedBase", label: "Expected base salary" }]);
  });

  it("lists everything for a fresh profile, and asks where the person can work before any work authorization question", () => {
    const ctx = createTestContext({ withAlexRivera: false });

    const keys = getProfile(ctx).missing.map((value) => `${value.section}.${value.key}`);

    expect(keys).toEqual(
      expect.arrayContaining(["contact.fullName", "contact.phone", "targets.regions", "employment.noticePeriod", "compensation.expectedBase"]),
    );
    expect(keys.filter((key) => key.startsWith("workAuthorization."))).toEqual([]);
  });

  it("names the boxes the way the Form answers screen does", () => {
    const ctx = createTestContext({ withAlexRivera: false });

    expect(labelsOfMissing(ctx)).toEqual(expect.arrayContaining(["Where you live", "Where you can work", "Expected base salary"]));
    expect(labelsOfMissing(ctx)).not.toContain("Location");
  });

  it("asks about work authorization only for the countries chosen, named in plain words", () => {
    const ctx = createTestContext();
    chooseWhereToWork(ctx, ["IN"]);

    expect(labelsOfMissing(ctx)).toEqual([
      "Authorized to work (India)",
      "Needs visa sponsorship (India)",
      "Willing to relocate (India)",
      "Expected base salary",
    ]);
  });

  it("with Remote jobs chosen, asks about the country where the person lives, and nothing about Remote itself", () => {
    const ctx = createTestContext();
    chooseWhereToWork(ctx, ["REMOTE"]);
    expect(labelsOfMissing(ctx)).toEqual(["Expected base salary"]); // Alex lives in Austin and answered for the US

    moveTo(ctx, "Pune, India");

    expect(labelsOfMissing(ctx)).toEqual([
      "Authorized to work (India)",
      "Needs visa sponsorship (India)",
      "Willing to relocate (India)",
      "Expected base salary",
    ]);
  });

  it("asks nothing for Somewhere else, which has no questions of its own", () => {
    const ctx = createTestContext();
    chooseWhereToWork(ctx, ["OTHER"]);

    expect(labelsOfMissing(ctx)).toEqual(["Expected base salary"]);
  });

  it("says which country Alex lives in, and the years limit that follows her experience", () => {
    const ctx = createTestContext();

    expect(getProfile(ctx)).toMatchObject({ homeRegion: "US", yearsLimit: { limit: 4, experience: 2 } });
  });

  it("has no home country and the stored years limit while those answers are missing", () => {
    const ctx = createTestContext({ withAlexRivera: false });

    expect(getProfile(ctx)).toMatchObject({ homeRegion: null, yearsLimit: { limit: 4, experience: null } });
  });

  it("has no warnings for Alex's details, or for a fresh profile", () => {
    expect(getProfile(createTestContext()).warnings).toEqual([]);
    expect(getProfile(createTestContext({ withAlexRivera: false })).warnings).toEqual([]);
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

  it("refuses a banned word in the contact details, naming the field, and saves none of the section", () => {
    const ctx = createTestContext();
    const contact = getProfile(ctx).profile.contact;

    expect(() => updateProfileSection(ctx, "contact", { ...contact, phone: "+1 555 0199", fullName: "Alex Rockstar Rivera" })).toThrowError(
      expect.objectContaining({ code: "banned-in-profile", field: "contact.fullName" }),
    );
    expect(getProfile(ctx).profile.contact).toMatchObject({ fullName: "Alex Rivera", phone: "+1 555 0100" });
  });

  it("refuses a contact value too long to use", () => {
    const ctx = createTestContext();
    const contact = getProfile(ctx).profile.contact;

    expect(() => updateProfileSection(ctx, "contact", { ...contact, location: "Austin, TX ".repeat(20) })).toThrowError(
      expect.objectContaining({ code: "too-long", field: "contact.location" }),
    );
    expect(getProfile(ctx).profile.contact.location).toBe("Austin, TX");
  });

  it("saves an email address that doesn't look like one, and says so next to it", () => {
    const ctx = createTestContext();
    const contact = getProfile(ctx).profile.contact;

    const response = updateProfileSection(ctx, "contact", { ...contact, email: "not-an-email" });

    expect(response.profile.contact.email).toBe("not-an-email");
    expect(response.warnings).toEqual([{ section: "contact", key: "email", message: expect.stringContaining("doesn't look like an email address") }]);
    expect(getProfile(ctx).warnings).toEqual(response.warnings);
  });

  it("checks only the contact details on save: banning a word that is already in them is allowed", () => {
    const ctx = createTestContext();

    const response = updateProfileSection(ctx, "rules", { bannedTerms: ["rockstar", "ninja", "Rivera"] });

    expect(response.profile.rules.bannedTerms).toContain("Rivera");
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

  it("tells a run the years limit the code filter uses: the person's experience + 2", () => {
    const ctx = createTestContext();
    const employment: Profile["employment"] = { ...getProfile(ctx).profile.employment, yearsExperience: "5" };
    updateProfileSection(ctx, "employment", employment);

    expect(getProfileForRun(ctx).targets.maxYearsRequired).toBe(7);
    expect(getProfile(ctx).profile.targets.maxYearsRequired).toBe(4); // the stored fallback is left as it was
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
