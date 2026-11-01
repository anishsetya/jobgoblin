import { describe, expect, it } from "vitest";
import { CAP_STATUSES } from "@jobgoblin/schemas";
import type { ApplicationStatus } from "@jobgoblin/schemas";
import { admitInScoreOrder, checkLimits } from "./limits";
import type { AdmissionCandidate, OtherApplication } from "./limits";

const NOW = new Date("2026-10-31T12:00:00.000Z");
const SETTINGS = { now: NOW, maxOpenPerCompany: 3, reapplyDays: 90 };

function anApplication(overrides: Partial<OtherApplication> & { id: string }): OtherApplication {
  return { company: "Acme Cloud", dedupeKey: `key-${overrides.id}`, status: "Tailored", appliedAt: null, ...overrides };
}

function openAtAcme(count: number, status: ApplicationStatus = "Tailored"): OtherApplication[] {
  return Array.from({ length: count }, (_, index) => anApplication({ id: `open-${index}`, status }));
}

function checkTheNewJob(others: OtherApplication[], overrides: { applicationId?: string; dedupeKey?: string } = {}) {
  return checkLimits({
    ...SETTINGS,
    applicationId: overrides.applicationId ?? "new-job",
    company: "Acme Cloud",
    dedupeKey: overrides.dedupeKey ?? "key-new-job",
    others,
  });
}

describe("checkLimits: open applications per company", () => {
  it("allows a new application when the company has fewer than the limit open", () => {
    expect(checkTheNewJob(openAtAcme(2))).toBeNull();
  });

  it("refuses the application that would be one over the limit, with code cap", () => {
    const error = checkTheNewJob(openAtAcme(3));

    expect(error?.code).toBe("cap");
    expect(error?.message).toContain("3 open applications at Acme Cloud");
  });

  it("counts an application whose status is in CAP_STATUSES (Tailored through Offer)", () => {
    expect(CAP_STATUSES).toContain("Awaiting approval");
    expect(checkTheNewJob(openAtAcme(3, "Awaiting approval"))?.code).toBe("cap");
  });

  it("does not count an application that has no resume yet or is closed", () => {
    expect(CAP_STATUSES).not.toContain("Scored");
    expect(CAP_STATUSES).not.toContain("Rejected");
    expect(checkTheNewJob(openAtAcme(5, "Scored"))).toBeNull();
    expect(checkTheNewJob(openAtAcme(5, "Rejected"))).toBeNull();
  });

  it("never counts the application being checked against itself", () => {
    const others = [...openAtAcme(2), anApplication({ id: "new-job", status: "Awaiting approval" })];

    expect(checkTheNewJob(others)).toBeNull();
  });

  it("does not count other companies, and ignores spelling differences in the company name", () => {
    const elsewhere = Array.from({ length: 4 }, (_, index) => anApplication({ id: `other-${index}`, company: "Brightpath" }));
    const sameCompanySpelledDifferently = openAtAcme(3).map((application) => ({ ...application, company: "ACME Cloud, Inc." }));

    expect(checkTheNewJob(elsewhere)).toBeNull();
    expect(checkTheNewJob(sameCompanySpelledDifferently)?.code).toBe("cap");
  });
});

describe("checkLimits: applying again to the same job", () => {
  const sameJob = "key-same-job";

  it("refuses a job applied to within the reapply window, and says when it can be applied to again", () => {
    const appliedLastMonth = anApplication({ id: "earlier", dedupeKey: sameJob, status: "Applied", appliedAt: "2026-10-01T09:00:00.000Z" });

    const error = checkTheNewJob([appliedLastMonth], { dedupeKey: sameJob });

    expect(error?.code).toBe("cap");
    expect(error?.message).toContain("2026-10-01");
    expect(error?.message).toContain("2026-12-30");
  });

  it("allows the job again once the window has passed", () => {
    const appliedLongAgo = anApplication({ id: "earlier", dedupeKey: sameJob, status: "Rejected", appliedAt: "2026-07-01T09:00:00.000Z" });

    expect(checkTheNewJob([appliedLongAgo], { dedupeKey: sameJob })).toBeNull();
  });

  it("applies to later statuses too, as long as the application reached Applied", () => {
    const rejected = anApplication({ id: "earlier", dedupeKey: sameJob, status: "Rejected", appliedAt: "2026-10-20T09:00:00.000Z" });

    expect(checkTheNewJob([rejected], { dedupeKey: sameJob })?.code).toBe("cap");
  });

  it("does not block a job that was only tailored or skipped before", () => {
    const neverApplied = anApplication({ id: "earlier", dedupeKey: sameJob, status: "Skipped", appliedAt: null });

    expect(checkTheNewJob([neverApplied], { dedupeKey: sameJob })).toBeNull();
  });

  it("does not block a different job", () => {
    const appliedOther = anApplication({ id: "earlier", dedupeKey: "key-other", status: "Applied", appliedAt: "2026-10-20T09:00:00.000Z" });

    expect(checkTheNewJob([appliedOther], { dedupeKey: sameJob })).toBeNull();
  });

  it("ignores the application's own earlier application", () => {
    const itself = anApplication({ id: "new-job", dedupeKey: sameJob, status: "Applied", appliedAt: "2026-10-20T09:00:00.000Z" });

    expect(checkTheNewJob([itself], { dedupeKey: sameJob })).toBeNull();
  });
});

function aCandidate(id: string, score: number, company = "Acme Cloud"): AdmissionCandidate {
  return { applicationId: id, company, dedupeKey: `key-${id}`, score };
}

describe("admitInScoreOrder", () => {
  it("with four roles at one company and a limit of three, admits the three best and refuses the weakest", () => {
    const candidates = [aCandidate("c-72", 72), aCandidate("c-90", 90), aCandidate("c-65", 65), aCandidate("c-80", 80)];

    const result = admitInScoreOrder(candidates, [], SETTINGS);

    expect(result.admitted).toEqual(["c-90", "c-80", "c-72"]);
    expect(result.refused.map((refusal) => refusal.applicationId)).toEqual(["c-65"]);
    expect(result.refused[0]?.message).toContain("3 open applications at Acme Cloud");
  });

  it("counts applications the person already has open", () => {
    const existing = openAtAcme(2);

    const result = admitInScoreOrder([aCandidate("c-90", 90), aCandidate("c-80", 80)], existing, SETTINGS);

    expect(result.admitted).toEqual(["c-90"]);
    expect(result.refused.map((refusal) => refusal.applicationId)).toEqual(["c-80"]);
  });

  it("admits roles at different companies independently", () => {
    const candidates = [aCandidate("a", 80, "Acme Cloud"), aCandidate("b", 70, "Brightpath")];

    expect(admitInScoreOrder(candidates, [], { ...SETTINGS, maxOpenPerCompany: 1 }).admitted).toEqual(["a", "b"]);
  });

  it("keeps the given order for equal scores", () => {
    const candidates = [aCandidate("first", 75), aCandidate("second", 75), aCandidate("third", 75)];

    const result = admitInScoreOrder(candidates, [], { ...SETTINGS, maxOpenPerCompany: 2 });

    expect(result.admitted).toEqual(["first", "second"]);
    expect(result.refused.map((refusal) => refusal.applicationId)).toEqual(["third"]);
  });

  it("refuses a candidate for a job the person applied to recently", () => {
    const applied = anApplication({ id: "earlier", dedupeKey: "key-c-90", status: "Applied", appliedAt: "2026-10-25T09:00:00.000Z" });

    const result = admitInScoreOrder([aCandidate("c-90", 90)], [applied], SETTINGS);

    expect(result.admitted).toEqual([]);
    expect(result.refused[0]?.message).toContain("2026-10-25");
  });

  it("admits nothing from an empty list", () => {
    expect(admitInScoreOrder([], [], SETTINGS)).toEqual({ admitted: [], refused: [] });
  });
});
