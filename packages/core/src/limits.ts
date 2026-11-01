// The two limits on applications: no more than a few open at one company (PRD T4), and a wait before
// applying again to the same job. Also decides which of several new roles get tailored first (D15).
// Spec: "Resume pipeline" step 4. ARCHITECTURE.md sections 6 and 8.3.
import { CAP_STATUSES } from "@jobgoblin/schemas";
import type { ApplicationStatus, ResumeCheckError } from "@jobgoblin/schemas";
import { normalizeCompanyName } from "./jobFilters";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const LIMIT_ERROR_PATH = "application"; // a limit is about the whole application, not one part of the resume

// Another application the person has, as far as the limits are concerned.
export type OtherApplication = {
  id: string;
  company: string;
  dedupeKey: string;
  status: ApplicationStatus;
  appliedAt: string | null; // set once the application reached Applied
};

export type LimitSettings = {
  now: Date;
  maxOpenPerCompany: number; // 3
  reapplyDays: number; // 90
};

export type LimitCheck = LimitSettings & {
  applicationId: string;
  company: string;
  dedupeKey: string;
  others: readonly OtherApplication[];
};

// Returns the first limit this application would break, or null. The application itself is never counted
// against itself, so tailoring it a second time is not blocked by its own first draft.
export function checkLimits(check: LimitCheck): ResumeCheckError | null {
  const recentApplication = findRecentApplicationToSameJob(check);
  if (recentApplication !== null) return reapplyError(recentApplication, check.reapplyDays);

  const openAtCompany = countOpenAtSameCompany(check);
  if (openAtCompany >= check.maxOpenPerCompany) return capError(check.company, check.maxOpenPerCompany);

  return null;
}

// The same job (same dedupe key) applied to within the reapply window. Returns the latest such application.
function findRecentApplicationToSameJob(check: LimitCheck): OtherApplication | null {
  const windowStart = check.now.getTime() - check.reapplyDays * MILLISECONDS_PER_DAY;
  let latest: OtherApplication | null = null;

  for (const other of check.others) {
    if (other.id === check.applicationId) continue;
    if (other.dedupeKey !== check.dedupeKey || other.appliedAt === null) continue;
    if (Date.parse(other.appliedAt) < windowStart) continue;
    if (latest === null || other.appliedAt > (latest.appliedAt ?? "")) latest = other;
  }
  return latest;
}

// Only CAP_STATUSES count (Tailored through Offer): a job that has no resume yet takes no one's place (D15).
function countOpenAtSameCompany(check: LimitCheck): number {
  const company = normalizeCompanyName(check.company);
  let count = 0;
  for (const other of check.others) {
    if (other.id === check.applicationId) continue;
    const isSameCompany = normalizeCompanyName(other.company) === company;
    if (isSameCompany && CAP_STATUSES.includes(other.status)) count += 1;
  }
  return count;
}

function capError(company: string, maxOpenPerCompany: number): ResumeCheckError {
  return {
    code: "cap",
    path: LIMIT_ERROR_PATH,
    message:
      `You already have ${maxOpenPerCompany} open applications at ${company}, which is your limit. ` +
      "Withdraw or finish one before taking on another.",
  };
}

function reapplyError(earlier: OtherApplication, reapplyDays: number): ResumeCheckError {
  const appliedOn = (earlier.appliedAt ?? "").slice(0, 10);
  const canApplyAgain = new Date(Date.parse(earlier.appliedAt ?? "") + reapplyDays * MILLISECONDS_PER_DAY);
  return {
    code: "cap",
    path: LIMIT_ERROR_PATH,
    message:
      `You applied to this job on ${appliedOn}. You can apply to it again from ` +
      `${canApplyAgain.toISOString().slice(0, 10)}, after the ${reapplyDays}-day wait.`,
  };
}

// A role waiting to be tailored after a hunt.
export type AdmissionCandidate = {
  applicationId: string;
  company: string;
  dedupeKey: string;
  score: number;
};

export type AdmissionResult = {
  admitted: string[]; // application ids to tailor, best score first
  refused: { applicationId: string; message: string }[];
};

// Decides, best score first, which candidates may be tailored. Each admitted candidate counts as an open
// application for the ones after it, so with four roles at one company and a limit of three, the three
// best get a resume and the fourth is refused with the plain cap message. Equal scores keep their order.
export function admitInScoreOrder(
  candidates: readonly AdmissionCandidate[],
  existing: readonly OtherApplication[],
  settings: LimitSettings,
): AdmissionResult {
  const bestFirst = [...candidates].sort((a, b) => b.score - a.score);
  const openSoFar: OtherApplication[] = [...existing];
  const result: AdmissionResult = { admitted: [], refused: [] };

  for (const candidate of bestFirst) {
    const error = checkLimits({ ...settings, ...candidate, others: openSoFar });
    if (error !== null) {
      result.refused.push({ applicationId: candidate.applicationId, message: error.message });
      continue;
    }
    result.admitted.push(candidate.applicationId);
    openSoFar.push(asAdmittedApplication(candidate));
  }
  return result;
}

// An admitted candidate is about to be Tailored, the first status that counts toward the cap.
function asAdmittedApplication(candidate: AdmissionCandidate): OtherApplication {
  return {
    id: candidate.applicationId,
    company: candidate.company,
    dedupeKey: candidate.dedupeKey,
    status: "Tailored",
    appliedAt: null,
  };
}
