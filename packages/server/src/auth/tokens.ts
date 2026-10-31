// Tokens: how the session token is made and how any token is compared.
// The comparison takes the same time whether the first or the last character differs, so a program on this
// computer cannot guess a token one character at a time by timing the answers.
// Spec: tech spec "Local HTTP API and authentication"; ARCHITECTURE.md section 11.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;

// 32 random bytes as 64 hex characters. It lives only in memory and is handed to the window by the desktop shell.
export function createSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

export function createRunToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

// Both sides are hashed first, so the two buffers always have the same length (timingSafeEqual needs that)
// and the length of the real token is not revealed either.
export function tokensMatch(given: string, expected: string): boolean {
  const givenDigest = createHash("sha256").update(given).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(givenDigest, expectedDigest);
}

// The token of an "Authorization: Bearer <token>" header, or null when the header is missing or not a bearer one.
export function readBearerToken(authorizationHeader: string | undefined): string | null {
  if (authorizationHeader === undefined) return null;
  const match = /^Bearer ([^\s]+)$/.exec(authorizationHeader.trim());
  return match?.[1] ?? null;
}
