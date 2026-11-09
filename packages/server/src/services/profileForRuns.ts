// What a Claude run may know about the profile, and the one thing it may write.
// A run sees work authorization, employment, targets and banned words: never contact details, salary or EEO
// answers (they reach a form only as {placeholders} filled in by code). A run may fill in a value that is
// still TODO or empty, but can never overwrite something the person typed, and can never touch the banned words.
// Threats stopped: personal data reaching a model; a run switching off the person's own guard.
// Spec: ARCHITECTURE.md section 9 (get_profile, save_profile_section).
import {
  PERSONAL_SECTIONS,
  Profile,
  TODO,
  type GetProfileOutput,
  type RunWritableSection,
  type SaveProfileSectionOutput,
} from "@jobgoblin/schemas";
import { codeFilterTargetsFor } from "@jobgoblin/core";
import { getProfile as readProfile, saveProfileSection } from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { announceProfileChange } from "./changes";
import { voidChangedApprovals } from "./approvalVoiding";
import { findMissingValues } from "./missingValues";
import { failed, succeeded, type Outcome } from "./serviceError";

export function getProfileForRun(ctx: ServerContext): GetProfileOutput {
  const profile = readProfile(ctx.db);
  const personal: readonly string[] = PERSONAL_SECTIONS;
  return {
    facts: { workAuthorization: profile.workAuthorization, employment: profile.employment },
    missing: findMissingValues(profile).filter((value) => !personal.includes(value.section)),
    targets: codeFilterTargetsFor(profile), // the years limit a run sees is the one the filter uses
    rules: profile.rules,
  };
}

export function saveProfileSectionFromRun(
  ctx: ServerContext,
  request: { section: RunWritableSection; data: Record<string, unknown> },
): Outcome<SaveProfileSectionOutput> {
  const current = readProfile(ctx.db)[request.section];
  const filledKeys: string[] = [];
  const merged = fillGaps(current, request.data, "", filledKeys);

  // The merged section must still be a valid one (a run might send the wrong kind of value).
  const checked = Profile.shape[request.section].safeParse(merged);
  if (!checked.success) {
    return failed([
      {
        code: "schema",
        message: `The ${request.section} data is not in the expected shape: ${checked.error.issues[0]?.message ?? "invalid"}.`,
      },
    ]);
  }

  // A key the section does not have was dropped by the schema, so it was not really filled in.
  const reallyFilled = filledKeys.filter((key) => hasPath(checked.data, key));
  if (reallyFilled.length > 0) {
    saveProfileSection(ctx.db, request.section, checked.data as Profile[typeof request.section], ctx.now().toISOString());
    voidChangedApprovals(ctx);
    announceProfileChange(ctx);
  }
  return succeeded({ section: request.section, filledKeys: reallyFilled });
}

function hasPath(value: unknown, dottedPath: string): boolean {
  let current: unknown = value;
  for (const key of dottedPath.split(".")) {
    if (!isPlainObject(current) || !(key in current)) return false;
    current = current[key];
  }
  return true;
}

function isStillToFill(value: unknown): boolean {
  if (value === undefined || value === null || value === TODO) return true;
  if (typeof value === "string") return value.trim() === "";
  return Array.isArray(value) && value.length === 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Walks the section the run sent. Where the stored value is still to fill, the run's value is taken;
// where the stored value is something the person typed, it is kept. Objects are walked key by key.
function fillGaps(stored: unknown, incoming: unknown, path: string, filledKeys: string[]): unknown {
  if (isPlainObject(stored) && isPlainObject(incoming)) {
    const result: Record<string, unknown> = { ...stored };
    for (const [key, incomingValue] of Object.entries(incoming)) {
      const childPath = path === "" ? key : `${path}.${key}`;
      result[key] = fillGaps(stored[key], incomingValue, childPath, filledKeys);
    }
    return result;
  }
  if (isStillToFill(stored) && !isStillToFill(incoming)) {
    filledKeys.push(path);
    return incoming;
  }
  return stored;
}
