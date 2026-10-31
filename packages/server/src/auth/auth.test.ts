import { describe, expect, it } from "vitest";
import { createRunTokens } from "./runTokens";
import { createSessionToken, readBearerToken, tokensMatch } from "./tokens";

describe("the session token", () => {
  it("is 32 random bytes as 64 hex characters, different every time", () => {
    const first = createSessionToken();

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(createSessionToken()).not.toBe(first);
  });
});

describe("tokensMatch", () => {
  it("accepts the same token and refuses any other", () => {
    expect(tokensMatch("abc123", "abc123")).toBe(true);
    expect(tokensMatch("abc124", "abc123")).toBe(false);
    expect(tokensMatch("", "abc123")).toBe(false);
  });

  it("compares tokens of different lengths without throwing", () => {
    expect(tokensMatch("short", "a-much-longer-token-than-the-first")).toBe(false);
  });
});

describe("readBearerToken", () => {
  it("reads the token of a Bearer header", () => {
    expect(readBearerToken("Bearer abc")).toBe("abc");
  });

  it("returns null for a missing header or another scheme", () => {
    expect(readBearerToken(undefined)).toBeNull();
    expect(readBearerToken("Basic abc")).toBeNull();
    expect(readBearerToken("Bearer")).toBeNull();
    expect(readBearerToken("Bearer a b")).toBeNull();
  });
});

describe("run tokens", () => {
  it("map a token to its run", () => {
    const tokens = createRunTokens();

    const token = tokens.issue("run-1");

    expect(tokens.runIdFor(token)).toBe("run-1");
    expect(tokens.runIdFor("not-a-token")).toBeNull();
  });

  it("keep runs apart", () => {
    const tokens = createRunTokens();
    const first = tokens.issue("run-1");
    const second = tokens.issue("run-2");

    expect(first).not.toBe(second);
    expect(tokens.runIdFor(first)).toBe("run-1");
    expect(tokens.runIdFor(second)).toBe("run-2");
  });

  it("stop working when the run is revoked", () => {
    const tokens = createRunTokens();
    const token = tokens.issue("run-1");

    tokens.revoke("run-1");

    expect(tokens.runIdFor(token)).toBeNull();
  });

  it("replace the earlier token when a run is issued a new one", () => {
    const tokens = createRunTokens();
    const old = tokens.issue("run-1");

    const fresh = tokens.issue("run-1");

    expect(tokens.runIdFor(old)).toBeNull();
    expect(tokens.runIdFor(fresh)).toBe("run-1");
  });
});
