// "I submitted": the person says they sent the application and gives proof. Only then does the application
// become Applied. It needs an approval that still counts (not used, not voided by a change of details), and
// if the file the person attached is not the approved one, they must confirm that on purpose.
// Truthfulness control: "Applied" always has proof behind it, and the file the company got is known.
// Spec: ARCHITECTURE.md section 8.6.
import type { Submission, SubmittedRequest } from "@jobgoblin/schemas";
import {
  getLatestApproval,
  getLiveApproval,
  getSetting,
  insertSubmission,
  markApprovalUsed,
  newId,
  updateApplicationFields,
} from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { finishApplicationChange } from "./changes";
import { localDayAfter } from "./dates";
import { loadApplicationOrFail } from "./loaders";
import { moveApplication } from "./moves";
import { conflict, invalid } from "./serviceError";

export function markSubmitted(
  ctx: ServerContext,
  request: SubmittedRequest & { applicationId: string },
): Submission {
  const application = loadApplicationOrFail(ctx, request.applicationId);
  if (application.status !== "Approved" && application.status !== "Filling") {
    throw conflict("not-submittable", `This application is "${application.status}", so it can't be marked as submitted.`, "Open it from Pipeline.");
  }

  const approval = getLiveApproval(ctx.db, application.id);
  if (approval === null) throw explainMissingApproval(ctx, application.id);

  if (request.proofType !== "person-saw-it" && request.proof.trim() === "") {
    throw invalid("proof-missing", "Add the proof that it was sent.", "Paste the confirmation text, or choose \"I saw it\".");
  }
  const attachedAnotherFile = request.attachedSha256 !== null && request.attachedSha256 !== approval.pdfSha256;
  if (attachedAnotherFile && request.confirmDifferentFile !== true) {
    throw conflict(
      "different-file",
      "The file you attached is not the resume you approved.",
      "Attach the approved file, or confirm that you applied with a different one.",
    );
  }

  const now = ctx.now();
  const submission: Submission = {
    id: newId(),
    applicationId: application.id,
    resumeVersion: approval.resumeVersion,
    attachedSha256: request.attachedSha256,
    proofType: request.proofType,
    proof: request.proof,
    submittedAt: now.toISOString(),
  };

  ctx.db.transaction(() => {
    insertSubmission(ctx.db, submission);
    markApprovalUsed(ctx.db, approval.id, submission.submittedAt);
    moveApplication(ctx, { application, to: "Applied", actor: "person", via: "submitted", type: "submitted", detail: request.proofType });
    updateApplicationFields(
      ctx.db,
      application.id,
      { appliedAt: submission.submittedAt, followUpOn: localDayAfter(now, getSetting(ctx.db, "followUpDays")) },
      submission.submittedAt,
    );
  });

  finishApplicationChange(ctx, application.id);
  return submission;
}

// Either the details changed after the person approved, or there was never an approval.
function explainMissingApproval(ctx: ServerContext, applicationId: string) {
  const latest = getLatestApproval(ctx.db, applicationId);
  if (latest !== null && latest.voidedAt !== null) {
    return conflict("approval-void", "Your details changed since you approved.", "Review the application again and approve it.");
  }
  return conflict("not-approved", "This application has not been approved.", "Approve it first.");
}
