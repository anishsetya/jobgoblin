// A run submits a resume draft (submit_resume_draft). The draft is checked against Your story, the banned
// words and the limits; rendered; read back to make sure it is exactly one page with no banned word in the
// printed text; and only then saved, with the application moving to "Awaiting approval" for the person.
// Every problem is returned at once as a value, so the run can fix the whole draft and submit again.
// Truthfulness control: nothing reaches the person's review unless it traces to what they confirmed.
// Spec: ARCHITECTURE.md section 8.4.
import {
  ResumeBody,
  type Application,
  type ResumeCheckError,
  type ResumeHeader,
  type SubmitResumeDraftOutput,
} from "@jobgoblin/schemas";
import { findBannedTerms, headerHash } from "@jobgoblin/core";
import { readPdf, TEMPLATE_VERSION } from "@jobgoblin/render";
import {
  getProfileSection,
  insertApplicationResumeIfNew,
  insertResumeVersionIfNew,
  listHistoryEvents,
  listStoryItems,
  updateApplicationFields,
} from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { finishApplicationChange } from "./changes";
import { recordHistory } from "./history";
import { loadApplicationOrFail, loadJobOfApplication } from "./loaders";
import { moveApplication } from "./moves";
import { checkDraftContent, schemaErrorsOf } from "./resumeChecks";
import { savePreview } from "./resumePdf";
import { buildResumeHeader, chooseShortId, versionIdFor } from "./resumeVersions";
import { conflict, failed, succeeded, type Outcome } from "./serviceError";

const DRAFTABLE_STATUSES = ["Scored", "Long shot", "Tailored"];

export async function submitResumeDraft(
  ctx: ServerContext,
  request: { applicationId: string; body: unknown },
): Promise<Outcome<SubmitResumeDraftOutput>> {
  const application = loadApplicationOrFail(ctx, request.applicationId);
  if (!DRAFTABLE_STATUSES.includes(application.status)) {
    throw conflict("not-draftable", `This application is "${application.status}", so its resume can't be changed by a run.`, "Move on to the next application.");
  }
  const notRequested = refuseUnrequestedLongShot(ctx, application);
  if (notRequested !== null) return failed([notRequested]);

  const parsed = ResumeBody.safeParse(request.body);
  if (!parsed.success) return failed(schemaErrorsOf(parsed.error));

  const job = loadJobOfApplication(ctx, application);
  const contentErrors = checkDraftContent(ctx, application, job, parsed.data);
  if (contentErrors.length > 0) return failed(contentErrors);

  const header = buildResumeHeader(getProfileSection(ctx.db, "contact"));
  const versionId = versionIdFor(parsed.data, header);
  const pdf = await ctx.renderer.renderResumePdf({ header, body: parsed.data, storyItems: listStoryItems(ctx.db), versionId });
  const pdfErrors = await checkRenderedPdf(ctx, pdf);
  if (pdfErrors.length > 0) return failed(pdfErrors);

  saveDraft(ctx, application, parsed.data, header, versionId);
  savePreview(ctx, versionId, pdf);
  finishApplicationChange(ctx, application.id);

  const shortId = chooseShortId(ctx.db, versionId);
  return succeeded({ versionId, shortId, status: "Awaiting approval" });
}

// A long shot is tailored only when the person clicks Tailor, which logs a "tailor-requested" event.
function refuseUnrequestedLongShot(ctx: ServerContext, application: Application): { code: string; message: string } | null {
  if (application.status !== "Long shot") return null;
  const wasRequested = listHistoryEvents(ctx.db, application.id).some((event) => event.type === "tailor-requested");
  if (wasRequested) return null;
  return {
    code: "tailor-not-requested",
    message: "This job is a long shot, and long shots are only tailored when the person asks. Do not make a resume for it.",
  };
}

// The rendered file must be exactly one page, and the printed text must not hold a banned word
// (the text of the PDF can differ from the text that went in, for example through hyphenation).
async function checkRenderedPdf(ctx: ServerContext, pdf: Uint8Array): Promise<ResumeCheckError[]> {
  const { pages, text } = await readPdf(pdf);
  const errors: ResumeCheckError[] = [];
  if (pages !== 1) {
    errors.push({
      code: "pages",
      path: "resume",
      message: `The resume is ${pages} pages long and must fit on exactly one. Remove a bullet or shorten some lines.`,
    });
  }
  const banned = getProfileSection(ctx.db, "rules").bannedTerms;
  errors.push(...findBannedTerms([{ path: "resume.pdf", text }], banned, "banned-in-pdf"));
  return errors;
}

// One transaction: the version, the application's use of it, and the moves to Tailored and Awaiting approval.
function saveDraft(
  ctx: ServerContext,
  application: Application,
  body: ResumeBody,
  header: ResumeHeader,
  versionId: SubmitResumeDraftOutput["versionId"],
): void {
  const now = ctx.now().toISOString();
  ctx.db.transaction(() => {
    const shortId = chooseShortId(ctx.db, versionId);
    insertResumeVersionIfNew(ctx.db, {
      versionId,
      shortId,
      body,
      headerHash: headerHash(header),
      templateVersion: TEMPLATE_VERSION,
      createdAt: now,
    });
    insertApplicationResumeIfNew(ctx.db, { applicationId: application.id, versionId, createdAt: now });
    updateApplicationFields(ctx.db, application.id, { resumeVersion: versionId, tailorError: null }, now);

    // A first draft goes Scored or Long shot to Tailored (the run), then on to Awaiting approval (the server).
    // A draft that answers an edit request starts from Tailored already.
    if (application.status !== "Tailored") {
      moveApplication(ctx, { application, to: "Tailored", actor: "run", via: "submit_resume_draft", detail: `Resume ${shortId}` });
    }
    moveApplication(ctx, {
      application: { id: application.id, status: "Tailored" },
      to: "Awaiting approval",
      actor: "server",
      via: "submit_resume_draft",
    });
    recordHistory(ctx, { applicationId: application.id, actor: "run", type: "resume-drafted", detail: `Resume ${shortId}` });
  });
}
