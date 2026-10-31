import { describe, expect, it } from "vitest";
import { findStrongVerbs, STRONG_VERBS } from "./strongVerbs";

describe("STRONG_VERBS", () => {
  it("covers every verb the spec names", () => {
    const listed = STRONG_VERBS.map((strong) => strong.verb);

    expect(listed).toEqual(
      expect.arrayContaining([
        "lead", "own", "build", "design", "launch", "manage", "architect", "found", "create", "spearhead",
        "direct", "head", "drive", "establish", "pioneer", "mentor", "scale", "ship",
      ]),
    );
  });

  it("lists each form of a verb under one verb only", () => {
    const forms = STRONG_VERBS.flatMap((strong) => strong.forms);

    expect(new Set(forms).size).toBe(forms.length);
  });
});

describe("findStrongVerbs", () => {
  it("finds a verb in any tense and says how it was written", () => {
    expect(findStrongVerbs("Led the team")).toEqual([{ verb: "lead", written: "led" }]);
    expect(findStrongVerbs("Leading the team")).toEqual([{ verb: "lead", written: "leading" }]);
    expect(findStrongVerbs("Drove adoption, having driven change")).toEqual([{ verb: "drive", written: "drove" }]);
  });

  it("is not case sensitive", () => {
    expect(findStrongVerbs("ARCHITECTED a system")).toEqual([{ verb: "architect", written: "architected" }]);
  });

  it("reports each verb once, in the order it first appears", () => {
    const verbs = findStrongVerbs("Shipped it, built it, then shipped more and built again");

    expect(verbs.map((used) => used.verb)).toEqual(["ship", "build"]);
  });

  it("does not take a noun, or a word that only contains a verb, for a claim", () => {
    expect(findStrongVerbs("Wrote system design docs that work at scale for the head office")).toEqual([]);
    expect(findStrongVerbs("Found and fixed a bug in the leadership dashboard")).toEqual([]);
    expect(findStrongVerbs("Contributed to the on-call rotation and wrote 15 runbooks")).toEqual([]);
  });
});
