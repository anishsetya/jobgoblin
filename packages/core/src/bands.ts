// Fit bands: which band a score falls in, and which status a recorded fit leads to.
// The cut-offs are the PRD's: 75 and up apply, 60-74 stretch, 50-59 long shot, under 50 skip.
// Spec: "Data model and storage" (fits) and "Application state machine". ARCHITECTURE.md section 6.
import type { ApplicationStatus, Band, FitInput } from "@jobgoblin/schemas";

export const APPLY_MINIMUM_SCORE = 75;
export const STRETCH_MINIMUM_SCORE = 60;
export const LONG_SHOT_MINIMUM_SCORE = 50;

export function bandFor(score: number): Band {
  if (score >= APPLY_MINIMUM_SCORE) return "apply";
  if (score >= STRETCH_MINIMUM_SCORE) return "stretch";
  if (score >= LONG_SHOT_MINIMUM_SCORE) return "long-shot";
  return "skip";
}

// The status the server moves a freshly scored application to (the "Scored -> ..." rows of the table).
//   hard skip or under 50  Skipped (low fit)
//   50 to 59               Long shot (tailored only when the person asks)
//   60 and up              stays Scored, ready to be tailored
export function statusAfterFit(fit: Pick<FitInput, "score" | "hardSkip">): ApplicationStatus {
  if (hasHardSkip(fit.hardSkip)) return "Skipped (low fit)";

  const band = bandFor(fit.score);
  if (band === "skip") return "Skipped (low fit)";
  if (band === "long-shot") return "Long shot";
  return "Scored";
}

// A hard skip is a reason in words. A blank reason from a run means "no hard skip", not "skip for no reason".
function hasHardSkip(hardSkip: string | null): boolean {
  return hardSkip !== null && hardSkip.trim() !== "";
}
