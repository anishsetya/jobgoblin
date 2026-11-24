import { describe, expect, it } from "vitest";
import { ContactSection, TODO } from "@jobgoblin/schemas";
import { CONTACT_MAX_LENGTHS, findContactWarnings, refuseContactProblems } from "./contactChecks";
import { ServiceError } from "./serviceError";

const ALEX = ContactSection.parse({
  fullName: "Alex Rivera",
  email: "alex.rivera@example.com",
  phone: "+1 555 0100",
  location: "Austin, TX",
  github: "github.com/alexrivera-example",
});
const BANNED_TERMS = ["rockstar", "ninja"];

function refusalOf(contact: ContactSection): ServiceError | null {
  try {
    refuseContactProblems(contact, BANNED_TERMS);
    return null;
  } catch (error) {
    if (error instanceof ServiceError) return error;
    throw error;
  }
}

function warnedKeys(contact: ContactSection): string[] {
  return findContactWarnings(contact).map((warning) => `${warning.section}.${warning.key}`);
}

describe("refuseContactProblems", () => {
  it("accepts Alex's contact details", () => {
    expect(refusalOf(ALEX)).toBeNull();
  });

  it("refuses a banned word with the words Approve uses, the field's name in front, and names the field", () => {
    expect(refusalOf({ ...ALEX, fullName: "Alex Rockstar Rivera" })).toMatchObject({
      kind: "invalid",
      code: "banned-in-profile",
      message: 'Full name: "rockstar" is on your banned words list. Reword this text without it.',
      action: "Change it, then save again.",
      field: "contact.fullName",
    });
  });

  it("finds a banned word in an optional link too, by its screen name without (optional)", () => {
    expect(refusalOf({ ...ALEX, portfolio: "alexrivera.example.com/ninja" })).toMatchObject({
      message: expect.stringMatching(/^Portfolio or website: "ninja"/),
      field: "contact.portfolio",
    });
  });

  it("refuses a value past its limit, saying how long it is and how long it may be", () => {
    expect(refusalOf({ ...ALEX, location: "A".repeat(101) })).toMatchObject({
      code: "too-long",
      message: "Where you live is 101 characters long. It can be at most 100.",
      action: "Shorten it, then save again.",
      field: "contact.location",
    });
  });

  it("accepts every field at exactly its limit", () => {
    const longest = ContactSection.parse(
      Object.fromEntries(Object.entries(CONTACT_MAX_LENGTHS).map(([key, limit]) => [key, "a".repeat(limit)])),
    );

    expect(refusalOf(longest)).toBeNull();
  });

  it("leaves empty and TODO values to the list of missing values", () => {
    expect(refusalOf({ ...ALEX, fullName: TODO, email: "", phone: "   " })).toBeNull();
  });

  it("reports the first problem in the order the fields are shown", () => {
    expect(refusalOf({ ...ALEX, location: "A".repeat(500), fullName: "Alex Ninja Rivera" })?.field).toBe("contact.fullName");
  });
});

describe("findContactWarnings", () => {
  it("has nothing to say about Alex's details", () => {
    expect(findContactWarnings(ALEX)).toEqual([]);
  });

  it("warns about an email address that doesn't look like one, in plain words", () => {
    expect(findContactWarnings({ ...ALEX, email: "not-an-email" })).toEqual([
      { section: "contact", key: "email", message: "This doesn't look like an email address. It is saved; check it before you apply." },
    ]);
    for (const email of ["alex@example", "alex rivera@example.com", "@example.com", "alex@@example.com"]) {
      expect(warnedKeys({ ...ALEX, email })).toEqual(["contact.email"]);
    }
  });

  it("accepts the email addresses people use, with spaces around them", () => {
    for (const email of ["alex.rivera@example.com", "a+jobs@mail.example.co.uk", " alex@example.org "]) {
      expect(warnedKeys({ ...ALEX, email })).toEqual([]);
    }
  });

  it("warns about a phone number that doesn't look like one", () => {
    expect(findContactWarnings({ ...ALEX, phone: "call me" })).toEqual([
      { section: "contact", key: "phone", message: "This doesn't look like a phone number. It is saved; check it before you apply." },
    ]);
    for (const phone of ["555", "12-34-56", "+1 555 0100 #23", "555 0100 then ask for Alex"]) {
      expect(warnedKeys({ ...ALEX, phone })).toEqual(["contact.phone"]);
    }
  });

  it("accepts phone numbers as they are written in different countries, extensions included", () => {
    for (const phone of ["+1 (512) 555-0100", "512.555.0100", "+44 20 7946 0958", "+91 98765 43210", "030/1234567", "+1 512 555 0100 ext. 23", "555-0100 x23"]) {
      expect(warnedKeys({ ...ALEX, phone })).toEqual([]);
    }
  });

  it("leaves empty and TODO values to the list of missing values", () => {
    expect(findContactWarnings({ ...ALEX, email: TODO, phone: "" })).toEqual([]);
  });

  it("never warns about the name, the place or the links, whose formats vary too much", () => {
    expect(findContactWarnings({ ...ALEX, fullName: "李 小龍", location: "?", linkedin: "my profile" })).toEqual([]);
  });
});
