// The routes end to end, over the Hono app with the session token: what each area answers is parsed with the
// schema the dashboard will parse it with, so the two sides cannot drift apart. The rules themselves are
// tested next to the services; here the question is "is it wired to the right address, in the right shape".
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  Application,
  ApplicationDetail,
  Backup,
  ImportResumeResponse,
  PipelineRow,
  ProfileResponse,
  SettingsResponse,
  StoryItem,
  Submission,
  TodayResponse,
} from "@jobgoblin/schemas";
import { getRun } from "@jobgoblin/storage";
import { z } from "zod";
import { anApplicationAwaitingApproval, repoRoot } from "../services/testSupport";
import { closeTestContexts, createTestApp } from "./testSupport";

afterEach(closeTestContexts);

describe("the read routes", () => {
  it("answer in the shapes the dashboard parses", async () => {
    const { call, ctx } = createTestApp();
    await anApplicationAwaitingApproval(ctx);

    const today = TodayResponse.parse(await (await call("/api/today")).json());
    const pipeline = z.array(PipelineRow).parse(await (await call("/api/pipeline?status=Awaiting%20approval")).json());
    const profile = ProfileResponse.parse(await (await call("/api/profile")).json());
    const story = z.array(StoryItem).parse(await (await call("/api/story")).json());
    const settings = SettingsResponse.parse(await (await call("/api/settings")).json());
    const backups = z.array(Backup).parse(await (await call("/api/backups")).json());

    expect(today.needsYou.map((item) => item.kind)).toEqual(["review"]);
    expect(pipeline).toHaveLength(1);
    expect(profile.missing.map((value) => value.key)).toEqual(["byRegion.US", "byRegion.REMOTE"]);
    expect(story).toHaveLength(22);
    expect(settings.setupComplete).toBe(true);
    expect(backups).toEqual([]);
  });
});

describe("an application through the routes", () => {
  it("is reviewed, approved and marked as submitted", async () => {
    const { call, ctx } = createTestApp();
    const applicationId = await anApplicationAwaitingApproval(ctx);
    // The one missing value in Alex's profile is filled in, as the person would on the Form answers screen.
    await call("/api/profile/compensation", { method: "PUT", json: { expectedBase: "120000" } });

    const detail = ApplicationDetail.parse(await (await call(`/api/apps/${applicationId}`)).json());
    const draftPdf = await call(`/api/apps/${applicationId}/resume.pdf`);
    const approved = Application.parse(
      await (await call(`/api/apps/${applicationId}/approve`, { method: "POST", json: { dataSheetHash: await currentHash(call, applicationId), submitMode: "manual" } })).json(),
    );
    const submission = Submission.parse(
      await (await call(`/api/apps/${applicationId}/submitted`, { method: "POST", json: { proofType: "person-saw-it", proof: "", attachedSha256: null } })).json(),
    );
    const applied = ApplicationDetail.parse(await (await call(`/api/apps/${applicationId}`)).json());

    expect(detail.actions.canApprove).toBe(true);
    expect(draftPdf.headers.get("content-type")).toBe("application/pdf");
    expect(new TextDecoder().decode((await draftPdf.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    expect(approved.status).toBe("Approved");
    expect(submission.applicationId).toBe(applicationId);
    expect(applied.application.status).toBe("Applied");
    expect(applied.submission?.id).toBe(submission.id);
  });
});

async function currentHash(call: ReturnType<typeof createTestApp>["call"], applicationId: string): Promise<string> {
  const detail = ApplicationDetail.parse(await (await call(`/api/apps/${applicationId}`)).json());
  return detail.dataSheetHash ?? "";
}

describe("the import-resume route", () => {
  it("reads a multipart upload of the sample PDF and queues the setup run", async () => {
    const { call, ctx } = createTestApp({ withAlexRivera: false });
    const form = new FormData();
    form.set("kind", "resume");
    form.set("file", new File([fs.readFileSync(path.join(repoRoot(), "fixtures", "resumes", "alex-rivera.pdf"))], "alex-rivera.pdf"));

    const response = await call("/api/import-resume", { method: "POST", body: form });

    const { runId } = ImportResumeResponse.parse(await response.json());
    expect(response.status).toBe(200);
    expect(getRun(ctx.db, runId ?? "")).toMatchObject({ kind: "setup", status: "queued" });
  });

  it("answers a password-protected PDF with plain words and a 400", async () => {
    const { call } = createTestApp({ withAlexRivera: false });
    const form = new FormData();
    form.set("kind", "resume");
    form.set("file", new File([fs.readFileSync(path.join(repoRoot(), "fixtures", "resumes", "broken", "password-protected.pdf"))], "password-protected.pdf"));

    const response = await call("/api/import-resume", { method: "POST", body: form });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "password-protected",
      message: "This PDF is protected with a password.",
      action: "Open it, save a copy without a password, and choose that copy.",
    });
  });

  it("asks for a file in plain words when none was sent", async () => {
    const { call } = createTestApp();

    const response = await call("/api/import-resume", { method: "POST", body: new FormData() });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid-request", message: expect.stringContaining("Choose a PDF") });
  });
});

describe("the export routes", () => {
  it("download the tracker as CSV and as a workbook", async () => {
    const { call, ctx } = createTestApp();
    await anApplicationAwaitingApproval(ctx);

    const csv = await call("/api/export/csv");
    const workbook = await call("/api/export/xlsx");

    expect(csv.headers.get("content-disposition")).toContain("Tracker.csv");
    expect((await csv.text()).split("\n")[0]).toContain("Company");
    expect(workbook.headers.get("content-type")).toContain("spreadsheetml");
    expect((await workbook.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });
});
