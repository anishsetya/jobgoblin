// The "ask" run, scripted. The person asked a question about one application (applicationId and
// question are in the run input). Claude would read the application and write an answer.
// The fake reads it and restates what it finds, so the result text is easy to check in a test.
//
// The calls, in order:
//   1. get_application   the application, its job, its fit and its history
// The text returned becomes the run's `result`, which the dashboard shows as the answer.
// Spec: ARCHITECTURE.md section 14 (ask) and decision D20 (get_application).
import type { RunScript } from "../session";

export const runAskScript: RunScript = async (session) => {
  const { applicationId, question } = session.input;
  if (applicationId === undefined || question === undefined) {
    throw new Error("An ask run needs an applicationId and a question in its run input.");
  }

  const { application, job } = await session.callForData("get_application", { applicationId });

  const fitText = application.fitScore === null ? "has no fit score yet" : `has a fit score of ${application.fitScore}`;
  return (
    `${job.company}, ${job.title}: the application is at "${application.status}" and ${fitText}. ` +
    `You asked: "${question}". This answer comes from the fake Claude, so it only restates what the application shows.`
  );
};
