import { afterEach, describe, expect, it } from "vitest";
import { getApplication, listHistoryEvents, listRunTasks, listRunsByStatus } from "@jobgoblin/storage";
import { submitResumeDraft } from "./resumes";
import { admitAfterHuntOrPaste, requestEdit, requestTailor } from "./tailoring";
import { getTailoringContext } from "./tailoringContext";
import {
  alexMasterBody,
  aScoredApplication,
  anApplicationAwaitingApproval,
  closeTestContexts,
  createTestContext,
} from "./testSupport";
import type { ServerContext } from "../context";

afterEach(closeTestContexts);

// Four roles at one company, best score first, each a different job.
function fourRolesAtAcme(ctx: ServerContext): string[] {
  const roles = [
    { title: "Backend Engineer", score: 90 },
    { title: "Platform Engineer", score: 80 },
    { title: "Software Engineer", score: 70 },
    { title: "Data Engineer", score: 65 },
  ];
  return roles.map((role, index) =>
    aScoredApplication(ctx, { jobId: `greenhouse:acmecloud:${2000 + index}`, title: role.title }, { score: role.score }),
  );
}

describe("admitAfterHuntOrPaste", () => {
  it("tailors the three best of four roles at one company and refuses the fourth with the plain reason", () => {
    const ctx = createTestContext();
    const [best, second, third, fourth] = fourRolesAtAcme(ctx);

    const report = admitAfterHuntOrPaste(ctx);

    expect(report).toMatchObject({ admitted: 3, refused: 1 });
    const [run] = listRunsByStatus(ctx.db, ["queued"]);
    expect(run?.kind).toBe("tailor");
    expect(listRunTasks(ctx.db, run?.id ?? "").map((task) => task.applicationId)).toEqual([best, second, third]);
    expect(getApplication(ctx.db, fourth ?? "")?.tailorError).toContain("3 open applications at Acme Cloud");
    expect(getApplication(ctx.db, best ?? "")?.tailorError).toBeNull();
  });

  it("counts applications that are already open at the company", async () => {
    const ctx = createTestContext();
    await anApplicationAwaitingApproval(ctx, { jobId: "greenhouse:acmecloud:1500", title: "Staff Engineer" });
    fourRolesAtAcme(ctx);

    const report = admitAfterHuntOrPaste(ctx);

    expect(report).toMatchObject({ admitted: 2, refused: 2 });
  });

  it("leaves long shots and low scores alone", () => {
    const ctx = createTestContext();
    aScoredApplication(ctx, { jobId: "lever:brightpath:1", company: "Brightpath" }, { score: 55 });
    aScoredApplication(ctx, { jobId: "lever:brightpath:2", company: "Brightpath", title: "Data Analyst" }, { score: 30 });

    expect(admitAfterHuntOrPaste(ctx)).toEqual({ runId: null, admitted: 0, refused: 0 });
  });

  it("does not queue an application twice", () => {
    const ctx = createTestContext();
    aScoredApplication(ctx);
    admitAfterHuntOrPaste(ctx);

    const second = admitAfterHuntOrPaste(ctx);

    expect(second.admitted).toBe(0);
    expect(listRunsByStatus(ctx.db, ["queued"])).toHaveLength(1);
  });
});

describe("requestTailor", () => {
  it("queues a tailor run for a long shot and logs the request", () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx, {}, { score: 55 });

    const run = requestTailor(ctx, applicationId);

    expect(run).toMatchObject({ kind: "tailor", status: "queued", model: "haiku" });
    expect(listHistoryEvents(ctx.db, applicationId).map((event) => event.type)).toContain("tailor-requested");
  });

  it("refuses with the cap message when the company already has three open applications", async () => {
    const ctx = createTestContext();
    for (const [index, title] of ["Staff", "Senior", "Lead"].entries()) {
      await anApplicationAwaitingApproval(ctx, { jobId: `greenhouse:acmecloud:${3000 + index}`, title: `${title} Engineer` });
    }
    const longShot = aScoredApplication(ctx, { jobId: "greenhouse:acmecloud:3100", title: "Intern Engineer" }, { score: 55 });

    expect(() => requestTailor(ctx, longShot)).toThrowError(expect.objectContaining({ code: "cap" }));
    expect(listRunsByStatus(ctx.db, ["queued"])).toHaveLength(0);
  });

  it("refuses an application that already has a run in progress", () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx, {}, { score: 55 });
    requestTailor(ctx, applicationId);

    expect(() => requestTailor(ctx, applicationId)).toThrowError(expect.objectContaining({ code: "application-busy" }));
  });
});

describe("requestEdit", () => {
  it("sends the resume back to Tailored with the note, and the next draft returns it to review", async () => {
    const ctx = createTestContext();
    const applicationId = await anApplicationAwaitingApproval(ctx);

    const run = requestEdit(ctx, applicationId, "Lead with the Go project");

    expect(getApplication(ctx.db, applicationId)?.status).toBe("Tailored");
    expect(run.input).toEqual({ editNote: "Lead with the Go project" });
    expect(getTailoringContext(ctx, { runId: run.id, applicationId }).editNote).toBe("Lead with the Go project");

    const outcome = await submitResumeDraft(ctx, { applicationId, body: alexMasterBody() });
    expect(outcome.ok).toBe(true);
    expect(getApplication(ctx.db, applicationId)?.status).toBe("Awaiting approval");
  });

  it("only works on a resume that is waiting for approval", () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx);

    expect(() => requestEdit(ctx, applicationId, "Shorter")).toThrowError(expect.objectContaining({ code: "not-editable" }));
  });
});

describe("getTailoringContext", () => {
  it("gives the master, every confirmed item, the fit's gaps, banned words and a wrapped job brief", () => {
    const ctx = createTestContext();
    const applicationId = aScoredApplication(ctx, {}, { score: 80, gaps: ["Kafka"], mustHaves: ["Python"] });
    admitAfterHuntOrPaste(ctx);
    const [run] = listRunsByStatus(ctx.db, ["queued"]);

    const context = getTailoringContext(ctx, { runId: run?.id ?? "", applicationId });

    expect(context.application).toMatchObject({ id: applicationId, company: "Acme Cloud" });
    expect(context.storyItems).toHaveLength(22);
    expect(context.master.sections.experience).toHaveLength(2);
    expect(context.gaps).toEqual(["Kafka"]);
    expect(context.bannedTerms).toEqual(["rockstar", "ninja"]);
    expect(context.jobSummary).toContain("<untrusted_job_posting>");
    expect(context.editNote).toBeNull();
  });
});
