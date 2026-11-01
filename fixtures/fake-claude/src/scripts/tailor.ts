// The "tailor" run, scripted. Claude would reorder and reword the master resume for one job.
// The fake only reorders (bullets that mention a must-have go first) and never writes new text.
//
// For every application in the run's queue (the loop is in taskQueue.ts):
//   1. next_task              the next application with no open question
//   2. get_tailoring_context  the master resume, the must-haves, and the edit note if the person asked for one
//   3. submit_resume_draft    the draft; when the server refuses parts of it, drop those parts and submit once more
//   4. complete_task          done, failed or waiting
// With FAKE_CLAUDE_ASK_FIRST=1 the first application gets ask_person after step 2 and is completed as waiting.
// With FAKE_CLAUDE_INVENT_BULLET=1 the first draft carries two lies the server must refuse.
// With FAKE_CLAUDE_REWORD=1 one bullet is reworded ("... that ..." becomes "..., which ...") with every fact kept.
// Spec: ARCHITECTURE.md section 14 (tailor).
import type { GetTailoringContextOutput, ResumeBody, ToolError } from "@jobgoblin/schemas";
import {
  addPartsThatCannotBeTraced,
  dropLastBulletOfFirstEntry,
  dropPartsNamedByErrors,
  putMustHavesFirst,
  rewordFirstBulletThatCan,
} from "../resumeDraft";
import type { RunScript, ScriptSession } from "../session";
import { askPersonIfSwitchedOn, summariseTaskCounts, workThroughTasks } from "../taskQueue";
import type { TaskResult } from "../taskQueue";

export const runTailorScript: RunScript = async (session) => {
  const counts = await workThroughTasks(session, (applicationId, isFirstTask) =>
    tailorOneApplication(session, applicationId, isFirstTask),
  );
  return summariseTaskCounts(counts, "resumes tailored");
};

async function tailorOneApplication(
  session: ScriptSession,
  applicationId: string,
  isFirstTask: boolean,
): Promise<TaskResult> {
  const context = await session.callForData("get_tailoring_context", { applicationId });

  const hasAsked = await askPersonIfSwitchedOn(session, {
    applicationId,
    isFirstTask,
    answeredQuestions: context.answeredQuestions,
    question: `For ${context.application.company}, should I lead with your infrastructure work or your API work?`,
  });
  if (hasAsked) return { outcome: "waiting" };

  const honestDraft = buildHonestDraft(context, session.input.editNote, session.settings.rewordOneBullet);
  const mustBeRefused = session.settings.inventBullet;
  const firstDraft = mustBeRefused ? addPartsThatCannotBeTraced(honestDraft) : honestDraft;
  return submitDraft(session, applicationId, firstDraft, { mustBeRefused });
}

// The master resume with the must-have bullets first, and one bullet less when the person asked for an edit.
function buildHonestDraft(
  context: GetTailoringContextOutput,
  runEditNote: string | undefined,
  shouldReword: boolean,
): ResumeBody {
  // The context knows the note for this application; the run input has the note the run was started with.
  const editNote = context.editNote ?? runEditNote ?? null;

  const reordered = putMustHavesFirst(context.master, context.mustHaves);
  const draft = shouldReword ? rewordFirstBulletThatCan(reordered) : reordered;
  return editNote === null ? draft : dropLastBulletOfFirstEntry(draft);
}

// Submits the draft. If the server refuses parts of it, drops exactly those parts and submits once more.
async function submitDraft(
  session: ScriptSession,
  applicationId: string,
  draft: ResumeBody,
  options: { mustBeRefused: boolean },
): Promise<TaskResult> {
  const firstReply = await session.call("submit_resume_draft", { applicationId, body: draft });
  if (firstReply.ok) {
    if (options.mustBeRefused) {
      // The made-up parts were accepted: the truth trace is broken. Say so instead of passing quietly.
      throw new Error("The server accepted a draft with parts that are not in Your story.");
    }
    return { outcome: "done" };
  }

  const repair = dropPartsNamedByErrors(draft, firstReply.errors);
  if (repair.droppedCount === 0) return failedBecauseOf(firstReply.errors); // nothing to drop, so nothing to fix

  const secondReply = await session.call("submit_resume_draft", { applicationId, body: repair.body });
  if (secondReply.ok) return { outcome: "done" };
  return failedBecauseOf(secondReply.errors);
}

function failedBecauseOf(errors: ToolError[]): TaskResult {
  const reasons = errors.map((error) => error.message).join(" ");
  return { outcome: "failed", note: `The server refused the draft. ${reasons}` };
}
