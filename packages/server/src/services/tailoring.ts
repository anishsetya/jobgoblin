// Starting tailoring: automatically after a hunt or paste run (best scores first, within the per-company
// limit), and on the person's request (Tailor on a long shot, Request edit on a resume under review).
// Spec: ARCHITECTURE.md section 8.3 and decision D15.
import type { Application, Run } from "@jobgoblin/schemas";
import { admitInScoreOrder, checkLimits, type AdmissionCandidate, type LimitSettings, type OtherApplication } from "@jobgoblin/core";
import {
  getJob,
  getSettings,
  listApplicationsByStatus,
  listLimitCandidates,
  updateApplicationFields,
} from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { announceApplication, saveChangesSoon } from "./changes";
import { recordHistory } from "./history";
import { loadApplicationOrFail, loadJobOfApplication } from "./loaders";
import { moveApplication } from "./moves";
import { announceQueuedRun, findActiveRunFor, insertQueuedRun } from "./runs";
import { conflict } from "./serviceError";

export type AdmissionReport = { runId: string | null; admitted: number; refused: number };

// Called when a hunt or paste run ends. Every Scored application with band apply or stretch that has not been
// tailored yet is a candidate. The best scores are admitted first; one refused by the per-company limit gets
// the plain reason as its tailor error (it then shows in Needs you as "not tailored") and is looked at again
// after the next hunt, when the limit may allow it.
export function admitAfterHuntOrPaste(ctx: ServerContext): AdmissionReport {
  const candidates = findAdmissionCandidates(ctx);
  if (candidates.length === 0) return { runId: null, admitted: 0, refused: 0 };

  const result = admitInScoreOrder(candidates, findOtherApplications(ctx, candidates), limitSettings(ctx));

  const run = ctx.db.transaction(() => {
    for (const refusal of result.refused) {
      updateApplicationFields(ctx.db, refusal.applicationId, { tailorError: refusal.message }, ctx.now().toISOString());
    }
    for (const applicationId of result.admitted) {
      updateApplicationFields(ctx.db, applicationId, { tailorError: null }, ctx.now().toISOString());
    }
    if (result.admitted.length === 0) return null;
    return insertQueuedRun(ctx, { kind: "tailor", applicationIds: result.admitted, input: {} });
  });

  for (const candidate of candidates) announceApplication(ctx, candidate.applicationId);
  if (run !== null) announceQueuedRun(ctx, run);
  saveChangesSoon(ctx);
  return { runId: run?.id ?? null, admitted: result.admitted.length, refused: result.refused.length };
}

function findAdmissionCandidates(ctx: ServerContext): AdmissionCandidate[] {
  const candidates: AdmissionCandidate[] = [];
  for (const application of listApplicationsByStatus(ctx.db, ["Scored"])) {
    const isWorthTailoring = application.band === "apply" || application.band === "stretch";
    // tailorAttempts above zero means a tailor run already tried and gave up; the person decides about those.
    if (!isWorthTailoring || application.tailorAttempts > 0) continue;
    if (findActiveRunFor(ctx, application.id) !== null) continue;

    const job = getJob(ctx.db, application.jobId);
    if (job === null) continue;
    candidates.push({
      applicationId: application.id,
      company: application.company,
      dedupeKey: job.dedupeKey,
      score: application.fitScore ?? 0,
    });
  }
  return candidates;
}

// Every application that could count against a candidate: those at the same company and those for the same role.
function findOtherApplications(ctx: ServerContext, candidates: AdmissionCandidate[]): OtherApplication[] {
  const byId = new Map<string, OtherApplication>();
  for (const candidate of candidates) {
    for (const other of listLimitCandidates(ctx.db, { company: candidate.company, dedupeKey: candidate.dedupeKey })) {
      byId.set(other.id, other);
    }
  }
  return [...byId.values()];
}

function limitSettings(ctx: ServerContext): LimitSettings {
  const settings = getSettings(ctx.db);
  return { now: ctx.now(), maxOpenPerCompany: settings.maxOpenPerCompany, reapplyDays: settings.reapplyDays };
}

// ---------------------------------------------------------------------------------------------
// On the person's request
// ---------------------------------------------------------------------------------------------

// "Tailor" on a Scored application or a long shot. The limits are checked first, so the person is told
// at once instead of after a run.
export function requestTailor(ctx: ServerContext, applicationId: string): Run {
  const application = loadApplicationOrFail(ctx, applicationId);
  if (application.status !== "Scored" && application.status !== "Long shot") {
    throw conflict("not-tailorable", `A resume can't be made while this application is "${application.status}".`, "Open it from Pipeline.");
  }
  refuseIfOverLimits(ctx, application);

  const run = ctx.db.transaction(() => {
    recordHistory(ctx, { applicationId, actor: "person", type: "tailor-requested" });
    // A new request starts fresh: an earlier failure no longer counts against it.
    updateApplicationFields(ctx.db, applicationId, { tailorAttempts: 0, tailorError: null }, ctx.now().toISOString());
    return insertQueuedRun(ctx, { kind: "tailor", applicationIds: [applicationId], input: {} });
  });
  announceApplication(ctx, applicationId);
  announceQueuedRun(ctx, run);
  return run;
}

function refuseIfOverLimits(ctx: ServerContext, application: Application): void {
  const job = loadJobOfApplication(ctx, application);
  const settings = getSettings(ctx.db);
  const problem = checkLimits({
    applicationId: application.id,
    company: application.company,
    dedupeKey: job.dedupeKey,
    others: listLimitCandidates(ctx.db, { company: application.company, dedupeKey: job.dedupeKey }),
    now: ctx.now(),
    maxOpenPerCompany: settings.maxOpenPerCompany,
    reapplyDays: settings.reapplyDays,
  });
  if (problem !== null) {
    throw conflict("cap", problem.message, "Change your limits in Settings, or finish another application first.");
  }
}

// "Request edit" on a resume that is awaiting approval: it goes back to Tailored and a run makes a new draft
// that follows the person's note.
export function requestEdit(ctx: ServerContext, applicationId: string, note: string): Run {
  const application = loadApplicationOrFail(ctx, applicationId);
  if (application.status !== "Awaiting approval") {
    throw conflict("not-editable", "Only a resume that is waiting for your approval can be edited.", "Open it from Pipeline.");
  }

  const run = ctx.db.transaction(() => {
    moveApplication(ctx, {
      application,
      to: "Tailored",
      actor: "person",
      via: "request_edit",
      detail: `Edit requested: ${note}`,
    });
    return insertQueuedRun(ctx, { kind: "tailor", applicationIds: [applicationId], input: { editNote: note } });
  });
  announceApplication(ctx, applicationId);
  announceQueuedRun(ctx, run);
  saveChangesSoon(ctx);
  return run;
}
