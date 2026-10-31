// The person's profile: reading it with the list of missing values, and saving one section.
// Saving can change what an approved application would send, so every live approval is checked afterwards
// and voided when its data sheet would now differ.
// Spec: ARCHITECTURE.md sections 5.3, 8.5 and 11 (GET /api/profile, PUT /api/profile/:section).
import type { Profile, ProfileResponse, ProfileSectionName } from "@jobgoblin/schemas";
import { getProfile as readProfile, saveProfileSection } from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { announceProfileChange, saveChangesSoon } from "./changes";
import { voidChangedApprovals } from "./approvalVoiding";
import { findMissingValues } from "./missingValues";

export function getProfile(ctx: ServerContext): ProfileResponse {
  const profile = readProfile(ctx.db);
  return { profile, missing: findMissingValues(profile) };
}

// `data` has already been checked against the section's schema (Profile.shape[section]) by the caller.
export function updateProfileSection<Section extends ProfileSectionName>(
  ctx: ServerContext,
  section: Section,
  data: Profile[Section],
): ProfileResponse {
  saveProfileSection(ctx.db, section, data, ctx.now().toISOString());
  voidChangedApprovals(ctx);
  announceProfileChange(ctx);
  saveChangesSoon(ctx);
  return getProfile(ctx);
}
