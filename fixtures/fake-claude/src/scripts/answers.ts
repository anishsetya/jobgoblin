// The "answers" run, scripted. After the person approves an application, Claude drafts answers to the
// form's screening questions. The fake answers from the data sheet and never sees the person's real
// details: personal values arrive as placeholders such as {email}, and are written back as placeholders.
// Code fills them in only when it writes Answers.md.
//
// For every application in the run's queue (the loop is in taskQueue.ts):
//   1. next_task      the next application with no open question
//   2. get_approved   the screening questions and the data sheet (personal values as {key})
//   3. save_answers   one answer per question
//   4. complete_task  done, failed or waiting
// With FAKE_CLAUDE_ASK_FIRST=1 the first application gets ask_person after step 2 and is completed as waiting.
// Spec: ARCHITECTURE.md section 14 (answers) and section 9 (save_answers).
import type { Answer, DataSheet, DataSheetKey, GetApprovedOutput } from "@jobgoblin/schemas";
import type { RunScript, ScriptSession } from "../session";
import { askPersonIfSwitchedOn, summariseTaskCounts, workThroughTasks } from "../taskQueue";
import type { TaskResult } from "../taskQueue";

export const runAnswersScript: RunScript = async (session) => {
  const counts = await workThroughTasks(session, (applicationId, isFirstTask) =>
    answerOneApplication(session, applicationId, isFirstTask),
  );
  return summariseTaskCounts(counts, "applications answered");
};

async function answerOneApplication(
  session: ScriptSession,
  applicationId: string,
  isFirstTask: boolean,
): Promise<TaskResult> {
  const approved = await session.callForData("get_approved", { applicationId });

  const hasAsked = await askPersonIfSwitchedOn(session, {
    applicationId,
    isFirstTask,
    answeredQuestions: approved.answeredQuestions,
    question: `Is there anything about ${approved.application.company} I should mention in your answers?`,
  });
  if (hasAsked) return { outcome: "waiting" };

  const reply = await session.call("save_answers", { applicationId, answers: draftAnswers(approved) });
  if (reply.ok) return { outcome: "done" };

  const reasons = reply.errors.map((error) => error.message).join(" ");
  return { outcome: "failed", note: `The server refused the answers. ${reasons}` };
}

// ---------------------------------------------------------------------------------------------
// Drafting: a question that mentions one of these topics is answered from that data sheet field.
// ---------------------------------------------------------------------------------------------

const QUESTION_TOPICS: { mentions: RegExp; key: DataSheetKey }[] = [
  { mentions: /sponsor/i, key: "requiresSponsorship" },
  { mentions: /authori[sz]|right to work/i, key: "workAuthorized" },
  { mentions: /relocat/i, key: "willingToRelocate" },
  { mentions: /notice/i, key: "noticePeriod" },
  { mentions: /start|availab/i, key: "earliestStartDate" },
  { mentions: /salary|compensation|expected base/i, key: "expectedBase" },
  { mentions: /years/i, key: "yearsExperience" },
  { mentions: /full name|your name/i, key: "fullName" },
  { mentions: /e-?mail/i, key: "email" },
  { mentions: /phone/i, key: "phone" },
  { mentions: /linkedin/i, key: "linkedin" },
  { mentions: /github/i, key: "github" },
  { mentions: /located|based|location|city/i, key: "location" },
];

const FALLBACK_QUESTION = "Why are you interested in this role?";

function draftAnswers(approved: GetApprovedOutput): Answer[] {
  const questions = approved.questions.length > 0 ? approved.questions : [FALLBACK_QUESTION];
  return questions.map((question) => ({ question, answer: answerFor(question, approved) }));
}

function answerFor(question: string, approved: GetApprovedOutput): string {
  for (const topic of QUESTION_TOPICS) {
    if (topic.mentions.test(question)) return valueOnSheet(approved.dataSheet, topic.key);
  }

  const { company, title } = approved.application;
  return (
    `I'm {firstName}, and I'm interested in the ${title} role at ${company} ` +
    "because it matches the backend and platform work I do."
  );
}

// The sheet's value: a real one for non-personal fields, "{key}" for personal ones. A field the sheet
// does not list also becomes "{key}", which is what code replaces later.
function valueOnSheet(dataSheet: DataSheet, key: DataSheetKey): string {
  const field = dataSheet.fields.find((candidate) => candidate.key === key);
  return field?.value ?? `{${key}}`;
}
