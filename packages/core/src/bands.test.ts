import { describe, expect, it } from "vitest";
import { bandFor, statusAfterFit } from "./bands";

describe("bandFor", () => {
  it.each([
    [0, "skip"],
    [49, "skip"],
    [50, "long-shot"],
    [59, "long-shot"],
    [60, "stretch"],
    [74, "stretch"],
    [75, "apply"],
    [100, "apply"],
  ] as const)("puts a score of %i in the %s band", (score, band) => {
    expect(bandFor(score)).toBe(band);
  });
});

describe("statusAfterFit", () => {
  it("skips a job scored under 50", () => {
    expect(statusAfterFit({ score: 49, hardSkip: null })).toBe("Skipped (low fit)");
  });

  it("makes a job scored 50 to 59 a long shot", () => {
    expect(statusAfterFit({ score: 50, hardSkip: null })).toBe("Long shot");
    expect(statusAfterFit({ score: 59, hardSkip: null })).toBe("Long shot");
  });

  it("keeps a job scored 60 or more as Scored", () => {
    expect(statusAfterFit({ score: 60, hardSkip: null })).toBe("Scored");
    expect(statusAfterFit({ score: 95, hardSkip: null })).toBe("Scored");
  });

  it("skips a hard skip whatever its score", () => {
    expect(statusAfterFit({ score: 90, hardSkip: "Posting is closed" })).toBe("Skipped (low fit)");
  });

  it("does not treat a blank hard skip reason as a hard skip", () => {
    expect(statusAfterFit({ score: 80, hardSkip: "  " })).toBe("Scored");
  });
});
