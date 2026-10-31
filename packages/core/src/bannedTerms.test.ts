import { describe, expect, it } from "vitest";
import { findBannedTerms } from "./bannedTerms";

describe("findBannedTerms", () => {
  it("finds a banned term whatever its case, and names where it was found", () => {
    const texts = [{ path: "sections.experience[0].bullets[1]", text: "Shipped as a Rockstar engineer" }];

    const errors = findBannedTerms(texts, ["rockstar", "ninja"]);

    expect(errors).toEqual([
      {
        code: "banned",
        path: "sections.experience[0].bullets[1]",
        message: expect.stringContaining('"rockstar"'),
      },
    ]);
  });

  it("returns nothing when no banned term appears", () => {
    const texts = [{ path: "headline", text: "Backend engineer who builds reliable APIs" }];

    expect(findBannedTerms(texts, ["rockstar", "ninja"])).toEqual([]);
  });

  it("reports each banned term in each text that has it", () => {
    const texts = [
      { path: "headline", text: "Code NINJA and rockstar" },
      { path: "skills[0]", text: "Ninja" },
      { path: "skills[1]", text: "Python" },
    ];

    const errors = findBannedTerms(texts, ["rockstar", "ninja"]);

    expect(errors.map((error) => [error.path, error.message.split('"')[1]])).toEqual([
      ["headline", "rockstar"],
      ["headline", "ninja"],
      ["skills[0]", "ninja"],
    ]);
  });

  it("matches whole words and their plurals, not parts of other words", () => {
    const texts = [{ path: "p", text: "The latest tests, in Qatar" }];

    expect(findBannedTerms(texts, ["test"]).map((error) => error.code)).toEqual(["banned"]);
    expect(findBannedTerms(texts, ["QA", "late"])).toEqual([]);
  });

  it("finds a banned phrase across any spacing, and terms with symbols", () => {
    const texts = [{ path: "p", text: "Worked on the testing   team using C++" }];

    expect(findBannedTerms(texts, ["testing team"])).toHaveLength(1);
    expect(findBannedTerms(texts, ["C++"])).toHaveLength(1);
  });

  it("ignores blank banned terms instead of matching everything", () => {
    expect(findBannedTerms([{ path: "p", text: "anything" }], ["", "  "])).toEqual([]);
  });

  it("reports banned-in-pdf when it is checking text read back from the PDF", () => {
    const errors = findBannedTerms([{ path: "pdf", text: "Rockstar" }], ["rockstar"], "banned-in-pdf");

    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("banned-in-pdf");
  });
});
