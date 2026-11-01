// Fingerprints: canonical JSON, SHA-256, and the resume version id built from them.
// Two resumes with the same body, the same header and the same template always get the same id, and
// changing any of the three gives a new one (decision D18).
// Spec: "Resume pipeline" step 7. ARCHITECTURE.md sections 5.6 and 6.
import { createHash } from "node:crypto";
import type { ResumeBody, ResumeHeader, ResumeShortId, ResumeVersionId } from "@jobgoblin/schemas";
import { CoreError } from "./errors";

const VERSION_ID_PREFIX = "r-";
export const SHORT_ID_LENGTH = 8; // hex characters shown to the person; the storage layer asks for more only on a clash

// JSON with every object's keys in sorted order and no spaces, so the same data always gives the same text.
// Only plain JSON values are allowed: anything else (a Date, NaN, a function) has no single obvious
// form, and hashing it would hide a bug.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(withSortedKeys(value));
}

function withSortedKeys(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return checkedNumber(value);
  if (Array.isArray(value)) return value.map(withSortedKeys);
  if (isPlainObject(value)) return sortedCopy(value);
  throw new CoreError("invalid-input", `A ${describeType(value)} cannot be turned into canonical JSON.`);
}

function sortedCopy(object: Record<string, unknown>): Record<string, unknown> {
  const entries: [string, unknown][] = [];
  for (const key of Object.keys(object).sort()) {
    const value = object[key];
    if (value === undefined) continue; // an unset key means the same as a missing one, as in JSON.stringify
    entries.push([key, withSortedKeys(value)]);
  }
  // fromEntries makes an own property even for a key such as "__proto__", which plain assignment would not.
  return Object.fromEntries(entries);
}

function checkedNumber(value: number): number {
  if (!Number.isFinite(value)) throw new CoreError("invalid-input", "NaN and Infinity cannot be turned into JSON.");
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function describeType(value: unknown): string {
  if (value === undefined) return "missing value";
  if (typeof value === "object") return "non-plain object";
  return typeof value;
}

// The SHA-256 of text (read as UTF-8) or bytes, as 64 lowercase hex characters.
export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

// The fingerprint of the header block (name, email, phone, location, links) a resume was built with.
// The header is not stored with the version, so a new phone number shows up only through this hash.
export function headerHash(header: ResumeHeader): string {
  return sha256Hex(canonicalJson(header));
}

// "r-" plus the full SHA-256 of the body, the header hash and the template version.
export function resumeVersionId(body: ResumeBody, headerDigest: string, templateVersion: string): ResumeVersionId {
  const hash = sha256Hex(canonicalJson({ body, headerHash: headerDigest, templateVersion }));
  return `${VERSION_ID_PREFIX}${hash}`;
}

// What the app shows: "r-" plus the first 8 hex characters. `length` is for the rare clash, when two
// different versions share their first 8 characters and the storage layer asks for a longer one.
export function shortVersionId(versionId: string, length: number = SHORT_ID_LENGTH): ResumeShortId {
  const isVersionId = /^r-[0-9a-f]{64}$/.test(versionId);
  if (!isVersionId) throw new CoreError("invalid-input", `"${versionId}" is not a resume version id.`);
  if (!Number.isInteger(length) || length < SHORT_ID_LENGTH || length > 64) {
    throw new CoreError("invalid-input", "A short version id has between 8 and 64 hex characters.");
  }
  return `${VERSION_ID_PREFIX}${versionId.slice(VERSION_ID_PREFIX.length, VERSION_ID_PREFIX.length + length)}`;
}
