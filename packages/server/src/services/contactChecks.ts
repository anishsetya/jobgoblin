// Checks on the contact details when they are saved, so a problem shows next to its field right away instead of
// at Approve, far from the field that caused it.
//   Refused: a value too long for a resume header or a form, and a banned word in any field (the same words as
//            Approve gives, with the field's name in front).
//   Warned:  an email address or phone number that does not look like one. It is saved anyway, because formats
//            vary by country, and the Form answers screen shows the warning next to the field.
// Spec: ARCHITECTURE.md sections 5.3 and 8.5.
import { findBannedTerms } from "@jobgoblin/core";
import { TODO, type ContactSection, type ProfileWarning } from "@jobgoblin/schemas";
import { invalid, type ServiceError } from "./serviceError";

type ContactKey = keyof ContactSection;

// The words the Form answers screen uses for each field, without "(optional)".
const CONTACT_FIELD_LABELS: Record<ContactKey, string> = {
  fullName: "Full name",
  email: "Email address",
  phone: "Phone number",
  location: "Where you live",
  linkedin: "LinkedIn address",
  github: "GitHub address",
  portfolio: "Portfolio or website",
};

// The longest value each field may hold. An email address can be 254 characters long (RFC 5321). The others are
// far past any real name, number, place or link, and still short enough for a resume header.
export const CONTACT_MAX_LENGTHS: Record<ContactKey, number> = {
  fullName: 100,
  email: 254,
  phone: 40,
  location: 100,
  linkedin: 300,
  github: 300,
  portfolio: 300,
};

// Something, an "@", something, a dot, something: and no spaces.
const LOOKS_LIKE_AN_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Digits, spaces and the marks numbers are written with, perhaps a leading "+" and an extension at the end.
const PHONE_CHARACTERS = /^\+?[\d\s().\/-]+(?:\s*(?:ext\.?|x)\s*\d+)?$/i;
const FEWEST_PHONE_DIGITS = 7;

function filledInValues(contact: ContactSection): [ContactKey, string][] {
  const keys = Object.keys(CONTACT_FIELD_LABELS) as ContactKey[];
  return keys.flatMap((key): [ContactKey, string][] => {
    const value = contact[key];
    return value === undefined || value === TODO || value.trim() === "" ? [] : [[key, value]];
  });
}

// Throws the first problem found, in the order the fields are shown, naming its field ("contact.fullName").
export function refuseContactProblems(contact: ContactSection, bannedTerms: readonly string[]): void {
  const problem = findContactProblem(contact, bannedTerms);
  if (problem !== null) throw problem;
}

function findContactProblem(contact: ContactSection, bannedTerms: readonly string[]): ServiceError | null {
  for (const [key, value] of filledInValues(contact)) {
    const label = CONTACT_FIELD_LABELS[key];
    const field = `contact.${key}`;

    const limit = CONTACT_MAX_LENGTHS[key];
    if (value.length > limit) {
      const length = value.length.toLocaleString("en-US");
      return invalid("too-long", `${label} is ${length} characters long. It can be at most ${limit}.`, "Shorten it, then save again.", field);
    }

    const banned = findBannedTerms([{ path: field, text: value }], bannedTerms)[0];
    if (banned !== undefined) {
      return invalid("banned-in-profile", `${label}: ${banned.message}`, "Change it, then save again.", field);
    }
  }
  return null;
}

// Saved values that look wrong. Empty and "TODO" values are left to the missing-values list.
export function findContactWarnings(contact: ContactSection): ProfileWarning[] {
  const warnings: ProfileWarning[] = [];
  for (const [key, value] of filledInValues(contact)) {
    if (key === "email" && !LOOKS_LIKE_AN_EMAIL.test(value.trim())) {
      warnings.push({ section: "contact", key, message: "This doesn't look like an email address. It is saved; check it before you apply." });
    }
    if (key === "phone" && !looksLikeAPhoneNumber(value)) {
      warnings.push({ section: "contact", key, message: "This doesn't look like a phone number. It is saved; check it before you apply." });
    }
  }
  return warnings;
}

function looksLikeAPhoneNumber(value: string): boolean {
  const text = value.trim();
  const digits = text.replace(/\D/g, "").length;
  return PHONE_CHARACTERS.test(text) && digits >= FEWEST_PHONE_DIGITS;
}
