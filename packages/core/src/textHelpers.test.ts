import { describe, expect, it } from "vitest";
import { containsWholeWord, escapeRegExp, normalizeSpaces } from "./textHelpers";

describe("escapeRegExp", () => {
  it("makes symbols in a term match as typed", () => {
    expect(new RegExp(escapeRegExp("C++ (v2)")).test("C++ (v2)")).toBe(true);
    expect(new RegExp(escapeRegExp("a.b")).test("axb")).toBe(false);
  });
});

describe("normalizeSpaces", () => {
  it("turns every run of spaces, tabs and line breaks into one space and trims the ends", () => {
    expect(normalizeSpaces("  a \t b\n\n c  ")).toBe("a b c");
  });
});

describe("containsWholeWord", () => {
  it("matches a whole word, ignoring case", () => {
    expect(containsWholeWord("Senior QA Engineer", "qa")).toBe(true);
  });

  it("does not match inside a longer word", () => {
    expect(containsWholeWord("The latest news", "test")).toBe(false);
    expect(containsWholeWord("Qatar", "QA")).toBe(false);
  });

  it("matches a plural only when plurals are allowed", () => {
    expect(containsWholeWord("Wrote unit tests", "test")).toBe(false);
    expect(containsWholeWord("Wrote unit tests", "test", true)).toBe(true);
  });

  it("matches a phrase across any spacing", () => {
    expect(containsWholeWord("Software   Test\nEngineer", "test engineer")).toBe(true);
  });

  it("never matches an empty phrase", () => {
    expect(containsWholeWord("anything", "")).toBe(false);
    expect(containsWholeWord("anything", "   ")).toBe(false);
  });
});
