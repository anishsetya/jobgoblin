// Helpers for resume versions: the header printed at the top (built by code from the contact section, never
// by a run), the version id that covers body + header + template (D18), and a short id that never clashes.
// Spec: ARCHITECTURE.md sections 5.6, 8.4 and decision D18.
import type { ContactSection, ResumeBody, ResumeHeader, ResumeShortId, ResumeVersionId } from "@jobgoblin/schemas";
import { TODO } from "@jobgoblin/schemas";
import { headerHash, resumeVersionId, shortVersionId, SHORT_ID_LENGTH } from "@jobgoblin/core";
import { TEMPLATE_VERSION } from "@jobgoblin/render";
import { getResumeVersionByShortId, type Database } from "@jobgoblin/storage";

function valueOrEmpty(value: string | undefined): string {
  return value === undefined || value === TODO ? "" : value.trim();
}

// A contact value still marked TODO is left blank, so a draft never prints the word "TODO" at the top.
// (Approval is refused while a required value is missing, so an approved resume never has a blank one.)
export function buildResumeHeader(contact: ContactSection): ResumeHeader {
  const links = [contact.linkedin, contact.github, contact.portfolio]
    .map(valueOrEmpty)
    .filter((link) => link !== "");
  return {
    fullName: valueOrEmpty(contact.fullName),
    email: valueOrEmpty(contact.email),
    phone: valueOrEmpty(contact.phone),
    location: valueOrEmpty(contact.location),
    links,
  };
}

// The id this body would have with this header. A new phone number gives a new id (decision D18).
export function versionIdFor(body: ResumeBody, header: ResumeHeader): ResumeVersionId {
  return resumeVersionId(body, headerHash(header), TEMPLATE_VERSION);
}

// "r-" and 8 hex characters, or longer in the very rare case another version already has those 8.
export function chooseShortId(db: Database, versionId: ResumeVersionId): ResumeShortId {
  for (let length = SHORT_ID_LENGTH; length <= 64; length += 2) {
    const shortId = shortVersionId(versionId, length);
    const owner = getResumeVersionByShortId(db, shortId);
    if (owner === null || owner.versionId === versionId) return shortId;
  }
  return versionId; // 64 characters cannot clash with a different id
}
