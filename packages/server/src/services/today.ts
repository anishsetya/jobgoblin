// Today: the screen that answers "what do I do now?". It lists everything waiting on the person (Needs you),
// the runs that are going or just ended (each shown as a card), and a small count of what got done today.
// Spec: ARCHITECTURE.md section 5.9 (TodayResponse, NeedsYouItem) and PRD "Screens: Today".
import type { Application, NeedsYouItem, Run, RunKind, TodayResponse } from "@jobgoblin/schemas";
import {
  countApplicationsCreatedSince,
  countStatusChangesSince,
  formatLocalDay,
  getApplication,
  getLiveApproval,
  getSettings,
  listApplicationsByStatus,
  listFollowUpsDue,
  listOpenQuestions,
  listRecentRuns,
} from "@jobgoblin/storage";
import type { ServerContext } from "../context";
import { startOfLocalDay } from "./dates";

const RECENT_RUNS_LOOKED_AT = 50;
const ENDED_RUN_CARD_HOURS = 24; // a finished run's card stays on Today this long, unless it is dismissed
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

// What comes first in Needs you: a question blocks work, then reviews, then the rest.
const KIND_ORDER: NeedsYouItem["kind"][] = [
  "question",
  "review",
  "ready-to-submit",
  "run-attention",
  "not-tailored",
  "follow-up-due",
  "long-shot",
];

const RUN_TITLES: Record<RunKind, string> = {
  setup: "Reading your resume",
  hunt: "Finding jobs",
  paste: "Scoring a job you added",
  tailor: "Making resumes",
  answers: "Writing answers",
  ask: "Your question",
};

export function getToday(ctx: ServerContext): TodayResponse {
  const settings = getSettings(ctx.db);
  return {
    needsYou: findNeedsYou(ctx),
    running: findRunCards(ctx),
    doneToday: countDoneToday(ctx),
    setupComplete: settings.setupComplete,
    usageNoticeSeen: settings.usageNoticeSeen,
  };
}

// ---------------------------------------------------------------------------------------------
// Needs you
// ---------------------------------------------------------------------------------------------

function findNeedsYou(ctx: ServerContext): NeedsYouItem[] {
  const items = [
    ...questionItems(ctx),
    ...reviewItems(ctx),
    ...readyToSubmitItems(ctx),
    ...runAttentionItems(ctx),
    ...notTailoredItems(ctx),
    ...followUpItems(ctx),
    ...longShotItems(ctx),
  ];
  return items.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.createdAt.localeCompare(b.createdAt));
}

function describe(application: Application): string {
  return `${application.title} at ${application.company}`;
}

function applicationItem(
  kind: NeedsYouItem["kind"],
  application: Application,
  detail: string,
  createdAt: string = application.updatedAt,
): NeedsYouItem {
  return { kind, id: application.id, applicationId: application.id, runId: null, title: describe(application), detail, createdAt };
}

function questionItems(ctx: ServerContext): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];
  for (const question of listOpenQuestions(ctx.db)) {
    const application = getApplication(ctx.db, question.applicationId);
    if (application === null) continue;
    // For a question the id is the question's own, so the answer box knows which one it answers.
    items.push({
      kind: "question",
      id: question.id,
      applicationId: application.id,
      runId: question.runId,
      title: describe(application),
      detail: question.text,
      createdAt: question.askedAt,
    });
  }
  return items;
}

function reviewItems(ctx: ServerContext): NeedsYouItem[] {
  const awaiting = listApplicationsByStatus(ctx.db, ["Awaiting approval"]).map((application) => {
    const fit = application.fitScore === null ? "" : `Fit ${application.fitScore}. `;
    return applicationItem("review", application, `${fit}Look over the resume, then approve it.`);
  });
  // Approved, but the person's details changed afterwards, so the approval no longer counts.
  const changed = listApplicationsByStatus(ctx.db, ["Approved"])
    .filter((application) => getLiveApproval(ctx.db, application.id) === null)
    .map((application) => applicationItem("review", application, "Your details changed since you approved this. Review it again."));
  return [...awaiting, ...changed];
}

function readyToSubmitItems(ctx: ServerContext): NeedsYouItem[] {
  return listApplicationsByStatus(ctx.db, ["Approved", "Filling", "Needs your input"])
    .filter((application) => getLiveApproval(ctx.db, application.id) !== null)
    .map((application) =>
      applicationItem("ready-to-submit", application, "Approved. Apply on the company's site, then say that you submitted it."),
    );
}

function notTailoredItems(ctx: ServerContext): NeedsYouItem[] {
  return listApplicationsByStatus(ctx.db, ["Scored", "Long shot"])
    .filter((application) => application.tailorError !== null)
    .map((application) => applicationItem("not-tailored", application, application.tailorError ?? ""));
}

function longShotItems(ctx: ServerContext): NeedsYouItem[] {
  return listApplicationsByStatus(ctx.db, ["Long shot"])
    .filter((application) => application.tailorError === null)
    .map((application) =>
      applicationItem("long-shot", application, `A long shot (fit ${application.fitScore ?? "unknown"}). Make a resume if you want to try it.`),
    );
}

function followUpItems(ctx: ServerContext): NeedsYouItem[] {
  return listFollowUpsDue(ctx.db, formatLocalDay(ctx.now())).map((application) => {
    const day = application.followUpOn ?? formatLocalDay(ctx.now());
    return applicationItem("follow-up-due", application, `You planned to follow up on ${day}.`, `${day}T00:00:00.000Z`);
  });
}

function runAttentionItems(ctx: ServerContext): NeedsYouItem[] {
  const needsAttention: Run["status"][] = ["failed", "blocked", "interrupted"];
  return listRecentRuns(ctx.db, RECENT_RUNS_LOOKED_AT)
    .filter((run) => needsAttention.includes(run.status) && run.dismissedAt === null)
    .map((run) => ({
      kind: "run-attention" as const,
      id: run.id,
      applicationId: null,
      runId: run.id,
      title: RUN_TITLES[run.kind],
      detail: run.outcomeMessage ?? "This run stopped before it finished.",
      createdAt: run.endedAt ?? run.queuedAt,
    }));
}

// ---------------------------------------------------------------------------------------------
// Running and done today
// ---------------------------------------------------------------------------------------------

// Runs that are going or waiting, and runs that ended recently and have not been dismissed.
function findRunCards(ctx: ServerContext): Run[] {
  const cutoff = ctx.now().getTime() - ENDED_RUN_CARD_HOURS * MILLISECONDS_PER_HOUR;
  const isActive = (run: Run): boolean => run.status === "queued" || run.status === "running" || run.status === "waiting";
  const endedRecently = (run: Run): boolean => run.endedAt !== null && Date.parse(run.endedAt) >= cutoff;

  return listRecentRuns(ctx.db, RECENT_RUNS_LOOKED_AT)
    .filter((run) => run.dismissedAt === null && (isActive(run) || endedRecently(run)))
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

function countDoneToday(ctx: ServerContext): TodayResponse["doneToday"] {
  const since = startOfLocalDay(ctx.now());
  return {
    found: countApplicationsCreatedSince(ctx.db, since),
    tailored: countStatusChangesSince(ctx.db, "Tailored", since),
    approved: countStatusChangesSince(ctx.db, "Approved", since),
    applied: countStatusChangesSince(ctx.db, "Applied", since),
  };
}
