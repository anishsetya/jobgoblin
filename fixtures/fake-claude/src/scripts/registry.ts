// Which script plays which run kind. Open the file for a kind to read exactly what the fake does for it.
// Typed as Record<RunKind, ...>, so adding a run kind to the schemas fails the build until it has a script.
// Spec: ARCHITECTURE.md section 14.
import type { RunKind } from "@jobgoblin/schemas";
import type { RunScript } from "../session";
import { runAnswersScript } from "./answers";
import { runAskScript } from "./ask";
import { runHuntScript } from "./hunt";
import { runPasteScript } from "./paste";
import { runSetupScript } from "./setup";
import { runTailorScript } from "./tailor";

export const SCRIPTS: Record<RunKind, RunScript> = {
  setup: runSetupScript,
  hunt: runHuntScript,
  paste: runPasteScript,
  tailor: runTailorScript,
  answers: runAnswersScript,
  ask: runAskScript,
};
