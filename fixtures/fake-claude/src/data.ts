// The two data files the scripts are driven by: Alex Rivera's story, and the fixed fake scores.
// They are JSON imports, so the bundler copies them into dist/cli.mjs and the fake runs from any folder.
// Both are parsed with their schemas here, so a typo in a data file fails at start-up, not halfway through a run.
// Spec: fixtures/README.md (the demo person and the demo job board).
import { ProposedStoryItem } from "@jobgoblin/schemas";
import { z } from "zod";
import scoresJson from "../data/scores.json";
import storyItemsJson from "../data/story-items.json";

// What the setup run proposes for Your story. Each item's tempId is also its id in
// fixtures/profiles/alex-rivera.json, so tests that skip setup see the same ids.
export const ALEX_RIVERA_PROPOSED_ITEMS: ProposedStoryItem[] = z.array(ProposedStoryItem).parse(storyItemsJson);

// Fake fit scores keyed by "Company|Title". A job that is not listed is scored from keyword overlap instead.
export const FIXED_SCORES: Record<string, number> = z
  .record(z.string(), z.number().int().min(0).max(100))
  .parse(scoresJson);
