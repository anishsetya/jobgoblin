// Sets up the demo person, Alex Rivera, the way the setup wizard would, but through the PUBLIC HTTP API only
// (no database access), so a test that is not about setup can start at Today. The data comes from
// fixtures/profiles/alex-rivera.json. Expected base stays TODO on purpose: one form answer is missing.
// Spec: fixtures/README.md ("The demo person") and ARCHITECTURE.md section 11 (HTTP API).
import fs from "node:fs";
import path from "node:path";
import type { TestServer } from "./server";

const PROFILE_FIXTURE = path.resolve(import.meta.dirname, "..", "..", "fixtures", "profiles", "alex-rivera.json");
export const RESUME_PDF = path.resolve(import.meta.dirname, "..", "..", "fixtures", "resumes", "alex-rivera.pdf");

// Files Jobgoblin must refuse with an honest message (made by packages/render/scripts/buildBrokenResumeFixtures.ts).
export function brokenResume(fileName: string): string {
  return path.resolve(import.meta.dirname, "..", "..", "fixtures", "resumes", "broken", fileName);
}
export const PASSWORD_PROTECTED_PDF = brokenResume("password-protected.pdf");

// The order the profile sections are saved in. Every section of the fixture is saved.
const PROFILE_SECTIONS = ["contact", "workAuthorization", "employment", "compensation", "eeo", "targets", "rules"] as const;

export type SeedOptions = {
  // true: the usage notice counts as read, so tests that are not about the notice never meet it.
  usageNoticeSeen?: boolean;
};

type FixtureStoryItem = {
  id: string;
  kind: string;
  parentId: string | null;
  status: string;
  data: unknown;
  keywords: string[];
};

type Fixture = { profile: Record<string, unknown>; storyItems: FixtureStoryItem[] };

type CreatedStoryItem = { id: string; status: string };

export function readAlexRiveraFixture(): Fixture {
  return JSON.parse(fs.readFileSync(PROFILE_FIXTURE, "utf8")) as Fixture;
}

// The seed helpers need only these two things of a server, so they also work for a server that a test reaches
// in another way (the Electron test calls the API from inside the desktop window).
export type SeedTarget = Pick<TestServer, "api" | "personFolder">;

export async function seedAlexRivera(server: SeedTarget, options: SeedOptions = {}): Promise<void> {
  const fixture = readAlexRiveraFixture();

  await server.api("/api/settings/folder", { body: { path: server.personFolder } });
  for (const section of PROFILE_SECTIONS) {
    await server.api(`/api/profile/${section}`, { method: "PUT", body: fixture.profile[section] });
  }
  await addStoryItems(server, fixture.storyItems);
  if (options.usageNoticeSeen === true) {
    await server.api("/api/settings", { method: "PUT", body: { usageNoticeSeen: true } });
  }
  await server.api("/api/setup/finish", { body: {} });
}

type PipelineRow = { id: string; company: string; title: string; status: string };

export async function findApplicationId(server: SeedTarget, company: string, title: string): Promise<string> {
  const rows = await server.api<PipelineRow[]>("/api/pipeline");
  const row = rows.find((candidate) => candidate.company === company && candidate.title === title);
  if (row === undefined) throw new Error(`There is no application for ${title} at ${company}. Pipeline: ${JSON.stringify(rows)}`);
  return row.id;
}

// A precondition for stories that begin AFTER applying (pipeline moves, backups): approve and record "I submitted"
// through the public API, the same two calls the Review and Open application screens make. The story that
// shows those screens is review-approve-apply.spec.ts.
export async function approveAndMarkApplied(server: TestServer, applicationId: string): Promise<void> {
  await approveThroughApi(server, applicationId);
  await server.api(`/api/apps/${applicationId}/submitted`, {
    body: { proofType: "person-saw-it", proof: "I saw the confirmation page.", attachedSha256: null },
  });
}

export async function approveThroughApi(server: SeedTarget, applicationId: string): Promise<void> {
  const detail = await server.api<{ dataSheetHash: string }>(`/api/apps/${applicationId}`);
  await server.api(`/api/apps/${applicationId}/approve`, { body: { dataSheetHash: detail.dataSheetHash, submitMode: "manual" } });
}

// Brings an unseeded app to the middle of the wizard without clicking through it: the folder is chosen and the
// demo resume is uploaded, so Claude's proposals are waiting in Your story. Setup is NOT finished.
export async function uploadResumeAndChooseFolder(server: TestServer): Promise<void> {
  await server.api("/api/settings/folder", { body: { path: server.personFolder } });

  const form = new FormData();
  form.set("kind", "resume");
  form.set("file", new Blob([fs.readFileSync(RESUME_PDF)], { type: "application/pdf" }), "alex-rivera.pdf");
  const response = await fetch(`${server.origin}/api/import-resume`, {
    method: "POST",
    headers: { Authorization: `Bearer ${server.token}` },
    body: form,
  });
  if (!response.ok) throw new Error(`Uploading the resume answered ${response.status}: ${await response.text()}`);
}

// Jobs and projects first, so each achievement can name the new id of its parent.
async function addStoryItems(server: SeedTarget, items: FixtureStoryItem[]): Promise<void> {
  const newIdOf = new Map<string, string>();
  const parentsFirst = [...items].sort((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null));

  for (const item of parentsFirst) {
    const parentId = item.parentId === null ? null : (newIdOf.get(item.parentId) ?? null);
    const created = await server.api<CreatedStoryItem>("/api/story", {
      body: { kind: item.kind, parentId, data: item.data, keywords: item.keywords },
    });
    newIdOf.set(item.id, created.id);
    if (created.status !== "confirmed") await server.api(`/api/story/${created.id}/confirm`, { body: {} });
  }
}
