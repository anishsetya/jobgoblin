// The person's profile: reading it with the list of missing values, the warnings about values that look wrong
// and what the screens show from it (the country of where they live, the years limit), and saving one section.
// Saving the contact section first refuses a banned word or a value too long to use (contactChecks.ts), so the
// problem is shown next to its field instead of at Approve.
// Saving can change what an approved application would send, so every live approval is checked afterwards
// and voided when its data sheet would now differ.
// Spec: ARCHITECTURE.md sections 5.3, 8.5 and 11 (GET /api/profile, PUT /api/profile/:section).
import type { ContactSection, Profile, ProfileResponse, ProfileSectionName } from "@jobgoblin/schemas";
import { homeRegionOf, yearsLimitFor } from "@jobgoblin/core";
import { getProfile as readProfile, getProfileSection, saveProfileSection } from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { announceProfileChange, saveChangesSoon } from "./changes";
import { voidChangedApprovals } from "./approvalVoiding";
import { findContactWarnings, refuseContactProblems } from "./contactChecks";
import { findMissingValues } from "./missingValues";

export function getProfile(ctx: ServerContext): ProfileResponse {
  const profile = readProfile(ctx.db);
  return {
    profile,
    missing: findMissingValues(profile),
    homeRegion: homeRegionOf(profile.contact.location),
    yearsLimit: yearsLimitFor(profile),
    warnings: findContactWarnings(profile.contact),
  };
}

// `data` has already been checked against the section's schema (Profile.shape[section]) by the caller.
export function updateProfileSection<Section extends ProfileSectionName>(
  ctx: ServerContext,
  section: Section,
  data: Profile[Section],
): ProfileResponse {
  if (section === "contact") {
    // TypeScript does not narrow `data` from `section`; the schema check above made it a contact section.
    refuseContactProblems(data as ContactSection, getProfileSection(ctx.db, "rules").bannedTerms);
  }
  saveProfileSection(ctx.db, section, data, ctx.now().toISOString());
  voidChangedApprovals(ctx);
  announceProfileChange(ctx);
  saveChangesSoon(ctx);
  return getProfile(ctx);
}
