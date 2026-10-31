import { Profile, TODO } from "@jobgoblin/schemas";
import { afterEach, describe, expect, it } from "vitest";
import { openTestDatabase, removeTempDirs, TEST_TIMESTAMP } from "../testSupport";
import { getProfile, getProfileSection, saveProfileSection } from "./profile";

afterEach(removeTempDirs);

describe("profile", () => {
  it("gives a fresh install the schema's defaults, with every form value still TODO", () => {
    const db = openTestDatabase();

    const profile = getProfile(db);

    expect(profile).toEqual(Profile.parse({}));
    expect(profile.contact.email).toBe(TODO);
    db.close();
  });

  it("saves one section and reads it back, leaving the others at their defaults", () => {
    const db = openTestDatabase();
    const contact = { fullName: "Alex Rivera", email: "alex.rivera@example.com", phone: "+1 555 0100", location: "Austin, TX" };

    saveProfileSection(db, "contact", contact, TEST_TIMESTAMP);

    expect(getProfileSection(db, "contact")).toEqual(contact);
    expect(getProfileSection(db, "eeo")).toEqual(Profile.parse({}).eeo);
    db.close();
  });

  it("replaces a section that was saved before", () => {
    const db = openTestDatabase();
    saveProfileSection(db, "rules", { bannedTerms: ["rockstar"] }, TEST_TIMESTAMP);

    saveProfileSection(db, "rules", { bannedTerms: ["rockstar", "ninja"] }, TEST_TIMESTAMP);

    expect(getProfileSection(db, "rules").bannedTerms).toEqual(["rockstar", "ninja"]);
    db.close();
  });

  it("refuses a section that does not match its schema", () => {
    const db = openTestDatabase();
    const notATargetsSection = { roles: "Backend Engineer" } as never;

    const save = () => saveProfileSection(db, "targets", notATargetsSection, TEST_TIMESTAMP);

    expect(save).toThrow();
    db.close();
  });
});
