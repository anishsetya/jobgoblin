import { describe, expect, it } from "vitest";
import { ResumeShortId, ResumeVersionId } from "@jobgoblin/schemas";
import type { ResumeHeader } from "@jobgoblin/schemas";
import { CoreError } from "./errors";
import { canonicalJson, headerHash, resumeVersionId, sha256Hex, shortVersionId } from "./versionId";
import { alexRiveraMasterBody } from "./testing/alexRivera";

const ALEX_HEADER: ResumeHeader = {
  fullName: "Alex Rivera",
  email: "alex.rivera@example.com",
  phone: "+1 555 0100",
  location: "Austin, TX",
  links: ["github.com/alexrivera-example"],
};

describe("canonicalJson", () => {
  it("gives the same text whatever order the keys were written in", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("keeps the order of arrays, because order is meaning", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("treats an unset key like a missing one", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it("keeps a key named __proto__ instead of losing it", () => {
    const parsed: unknown = JSON.parse('{"__proto__": {"x": 1}, "a": 2}');

    expect(canonicalJson(parsed)).toBe('{"__proto__":{"x":1},"a":2}');
  });

  it.each([
    ["a Date", new Date(0)],
    ["NaN", Number.NaN],
    ["a function", () => 1],
    ["a bigint", 10n],
  ])("refuses %s, which has no single JSON form", (_name, value) => {
    expect(() => canonicalJson({ value })).toThrow(CoreError);
  });

  it("refuses undefined on its own or inside an array, where JSON would turn it into null", () => {
    expect(() => canonicalJson(undefined)).toThrow(CoreError);
    expect(() => canonicalJson([1, undefined])).toThrow(CoreError);
  });
});

describe("sha256Hex", () => {
  it("is the standard SHA-256 in lowercase hex", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("hashes bytes the same as the text they spell", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(sha256Hex("abc"));
  });
});

describe("resumeVersionId", () => {
  const body = alexRiveraMasterBody();

  it("is r- plus 64 hex characters", () => {
    const id = resumeVersionId(body, headerHash(ALEX_HEADER), "t1");

    expect(ResumeVersionId.safeParse(id).success).toBe(true);
  });

  it("is the same for the same body, header and template, however the body was built", () => {
    const rebuilt = JSON.parse(JSON.stringify(body)) as typeof body;

    expect(resumeVersionId(rebuilt, headerHash(ALEX_HEADER), "t1")).toBe(resumeVersionId(body, headerHash(ALEX_HEADER), "t1"));
  });

  it("changes when the body changes", () => {
    const changed = JSON.parse(JSON.stringify(body)) as typeof body;
    changed.skills = [];

    expect(resumeVersionId(changed, headerHash(ALEX_HEADER), "t1")).not.toBe(resumeVersionId(body, headerHash(ALEX_HEADER), "t1"));
  });

  it("changes when the header changes, for example a new phone number", () => {
    const newPhone = { ...ALEX_HEADER, phone: "+1 555 0199" };

    expect(headerHash(newPhone)).not.toBe(headerHash(ALEX_HEADER));
    expect(resumeVersionId(body, headerHash(newPhone), "t1")).not.toBe(resumeVersionId(body, headerHash(ALEX_HEADER), "t1"));
  });

  it("changes when the template version changes", () => {
    expect(resumeVersionId(body, headerHash(ALEX_HEADER), "t2")).not.toBe(resumeVersionId(body, headerHash(ALEX_HEADER), "t1"));
  });
});

describe("shortVersionId", () => {
  const id = resumeVersionId(alexRiveraMasterBody(), headerHash(ALEX_HEADER), "t1");

  it("is r- plus the first 8 hex characters", () => {
    const short = shortVersionId(id);

    expect(short).toMatch(/^r-[0-9a-f]{8}$/);
    expect(id.startsWith(short)).toBe(true);
    expect(ResumeShortId.safeParse(short).success).toBe(true);
  });

  it("can grow when two versions clash", () => {
    expect(shortVersionId(id, 12)).toHaveLength(2 + 12);
    expect(id.startsWith(shortVersionId(id, 12))).toBe(true);
  });

  it("refuses something that is not a version id, or a length outside 8 to 64", () => {
    expect(() => shortVersionId("r-1234")).toThrow(CoreError);
    expect(() => shortVersionId(id, 4)).toThrow(CoreError);
    expect(() => shortVersionId(id, 65)).toThrow(CoreError);
  });
});
