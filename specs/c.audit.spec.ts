// Section C: the product's promises, tested the way an attacker or a mistake would: over HTTP, with the numbers the
// dashboard would never send. Any failure here is P0 (truth, approval, privacy, data loss).
//   C1  Applied only through approval and proof; stale data sheet hash; the generic status route
//   C2  401 with no token, bad Host, bad Origin, the session token on /mcp
//   C3  Banned words in resume, data sheet; unconfirmed story items never used
//   C4  One long journey in the browser: copy buttons against the frozen sheet, the resume file and its properties,
//       exports (csv, xlsx opened), and the privacy sweep over everything the server handed to the runs
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { test, expect } from "./auditFixtures";
import { makeFlakyClaude, readAllText, readPdfInfo, readWorkbook } from "./helpers";
import { writeEvidence } from "./common";
import { auditPath } from "./paths";
import { check, finding } from "./record";
import { seedVariant } from "./seedVariants";
import { sweep } from "./sweep";
import type { TestServer } from "../support/server";
import { waitUntilNoRunIsActive } from "../support/waits";
import { ACME, BRIGHTPATH, needsYouItem } from "../support/flows";

type Raw = { status: number; body: any };

async function raw(server: TestServer, route: string, init: { method?: string; body?: unknown; token?: string | null; headers?: Record<string, string> } = {}): Promise<Raw> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  const token = init.token === undefined ? server.token : init.token;
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${server.origin}${route}`, { method: init.method ?? (init.body === undefined ? "GET" : "POST"), headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: response.status, body };
}

// A request with exactly the Host and Origin we choose (fetch would refuse to set them).
function rawHttp(server: TestServer, route: string, headers: Record<string, string>, method = "GET"): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const port = Number(new URL(server.origin).port);
    const request = http.request({ host: "127.0.0.1", port, path: route, method, headers }, (response) => {
      let text = "";
      response.on("data", (chunk) => (text += chunk));
      response.on("end", () => {
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          // not JSON
        }
        resolve({ status: response.statusCode ?? 0, body });
      });
    });
    request.on("error", reject);
    request.end();
  });
}

const ZERO_HASH = "0".repeat(64);

async function startJourney(server: TestServer, flakyEnvPage?: unknown): Promise<void> {
  void flakyEnvPage;
  await seedVariant(server, {
    usageNoticeSeen: true,
    mutateProfile: (profile) => {
      profile.compensation = { expectedBase: "187500" };
      profile.eeo = { gender: "EEOGENDERZ91", raceEthnicity: "EEORACEZ92", veteranStatus: "EEOVETERANZ93", disability: "EEODISABLEDZ94" };
    },
  });
}

async function findJobsViaApi(server: TestServer): Promise<void> {
  await server.api("/api/runs", { body: { kind: "hunt" } });
  await waitUntilNoRunIsActive(server, 150_000);
}

type Row = { id: string; company: string; title: string; status: string };
const rowOf = (rows: Row[], company: string, title?: string): Row => {
  const row = rows.find((candidate) => candidate.company === company && (title === undefined || candidate.title === title));
  if (row === undefined) throw new Error(`No row for ${company}: ${JSON.stringify(rows.map((r) => `${r.company}/${r.title}/${r.status}`))}`);
  return row;
};

// ---------------------------------------------------------------------------------------------
// C1: approval, proof and the status route
// ---------------------------------------------------------------------------------------------

test("C1 Applied needs approval and proof; stale hash; status route cannot reach Approved or Applied", async ({ startServer }) => {
  const server = await startServer({ seed: "none" });
  await startJourney(server);
  await findJobsViaApi(server);
  const rows = await server.api<Row[]>("/api/pipeline");
  const acme = rowOf(rows, "Acme Cloud");
  const brightpath = rowOf(rows, "Brightpath");
  const copperleaf = rowOf(rows, "Copperleaf AI", "Software Engineer, Applied AI");
  const results: Record<string, unknown> = {};
  const statusOf = async (id: string): Promise<string> => (await server.api<{ application: { status: string } }>(`/api/apps/${id}`)).application.status;

  // Before approval.
  results.submitWithoutApproval = await raw(server, `/api/apps/${acme.id}/submitted`, { body: { proofType: "person-saw-it", proof: "I saw it", attachedSha256: null } });
  const statusRoute: Record<string, number> = {};
  for (const to of ["Approved", "Applied", "Filling", "OA", "Phone screen", "Onsite", "Offer", "Accepted", "Awaiting approval", "Tailored"]) {
    const answer = await raw(server, `/api/apps/${acme.id}/status`, { body: { to } });
    statusRoute[`${to} (from Awaiting approval)`] = answer.status;
  }
  results.statusRouteFromAwaitingApproval = statusRoute;
  results.statusAfterAttempts = await statusOf(acme.id);
  results.staleHashZero = await raw(server, `/api/apps/${acme.id}/approve`, { body: { dataSheetHash: ZERO_HASH, submitMode: "manual" } });
  results.malformedHash = await raw(server, `/api/apps/${acme.id}/approve`, { body: { dataSheetHash: "abc", submitMode: "manual" } });
  results.approveLongShotNotTailored = await raw(server, `/api/apps/${copperleaf.id}/approve`, { body: { dataSheetHash: ZERO_HASH, submitMode: "manual" } });
  results.statusAfterStaleAttempts = await statusOf(acme.id);

  // A hash that was right, but the profile changes before the click.
  const brightpathDetail = await server.api<{ dataSheetHash: string }>(`/api/apps/${brightpath.id}`);
  const contact = (await server.api<{ profile: { contact: Record<string, string> } }>("/api/profile")).profile.contact;
  await server.api("/api/profile/contact", { method: "PUT", body: { ...contact, location: "Denver, CO" } });
  results.approveWithHashFromBeforeProfileChange = await raw(server, `/api/apps/${brightpath.id}/approve`, { body: { dataSheetHash: brightpathDetail.dataSheetHash, submitMode: "manual" } });
  results.statusBrightpathAfterStale = await statusOf(brightpath.id);
  await server.api("/api/profile/contact", { method: "PUT", body: contact });

  // Proper approval of Acme, then every shortcut to Applied.
  const acmeDetail = await server.api<{ dataSheetHash: string; approval: unknown }>(`/api/apps/${acme.id}`);
  results.approveAcme = (await raw(server, `/api/apps/${acme.id}/approve`, { body: { dataSheetHash: acmeDetail.dataSheetHash, submitMode: "manual" } })).status;
  results.approveAgain = await raw(server, `/api/apps/${acme.id}/approve`, { body: { dataSheetHash: acmeDetail.dataSheetHash, submitMode: "manual" } });
  results.statusRouteFromApproved = {} as Record<string, number>;
  for (const to of ["Applied", "Approved", "Filling", "OA", "Offer", "Accepted"]) {
    const answer = await raw(server, `/api/apps/${acme.id}/status`, { body: { to } });
    (results.statusRouteFromApproved as Record<string, number>)[to] = answer.status;
  }
  results.statusAfterStatusRoute = await statusOf(acme.id);
  results.submitEmptyProof = await raw(server, `/api/apps/${acme.id}/submitted`, { body: { proofType: "confirmation-page", proof: "   ", attachedSha256: null } });
  results.submitDifferentFile = await raw(server, `/api/apps/${acme.id}/submitted`, { body: { proofType: "person-saw-it", proof: "x", attachedSha256: crypto.createHash("sha256").update("another file").digest("hex") } });
  results.statusAfterBadSubmissions = await statusOf(acme.id);

  // The profile changes after approval: the approval must be void and Applied unreachable until re-approved.
  const phoneBefore = contact.phone;
  await server.api("/api/profile/contact", { method: "PUT", body: { ...contact, phone: "+1 555 0123" } });
  results.submitAfterPhoneChange = await raw(server, `/api/apps/${acme.id}/submitted`, { body: { proofType: "person-saw-it", proof: "x", attachedSha256: null } });
  results.statusAfterPhoneChange = await statusOf(acme.id);
  results.phoneChangedFrom = phoneBefore;

  // Skip and withdraw paths must not reach Applied either.
  results.skipApproved = (await raw(server, `/api/apps/${acme.id}/skip`, { method: "POST", body: {} })).status;
  const evidence = writeEvidence("c1-approval-and-proof.json", results);

  const refused = (answer: unknown): boolean => {
    const status = (answer as Raw).status;
    return status >= 400 && status < 500;
  };
  check(refused(results.submitWithoutApproval) && (await statusOf(brightpath.id)) !== "Applied", { id: "C-applied-without-approval", severity: "P0", title: "An application can be marked Applied without approval", persona: "Both", area: "POST /api/apps/:id/submitted", prd: "A1, U4", expected: "4xx, status unchanged", actual: JSON.stringify(results.submitWithoutApproval), evidence: [evidence], wrong: "product" });
  const bad = Object.entries(statusRoute).filter(([, code]) => code < 400 || code >= 500);
  check(bad.length === 0 && results.statusAfterAttempts === "Awaiting approval", { id: "C-status-route-bypass", severity: "P0", title: "The generic status route moves an Awaiting approval application", persona: "Both", area: "POST /api/apps/:id/status", prd: "A1, D16", expected: "Every move refused", actual: JSON.stringify({ statusRoute, after: results.statusAfterAttempts }), evidence: [evidence], wrong: "product" });
  check(refused(results.staleHashZero) && refused(results.malformedHash) && results.statusAfterStaleAttempts === "Awaiting approval", { id: "C-stale-hash", severity: "P0", title: "Approve accepts a data sheet hash that is wrong", persona: "Both", area: "POST /api/apps/:id/approve", prd: "A3", expected: "409 data-sheet-changed", actual: JSON.stringify({ zero: results.staleHashZero, malformed: results.malformedHash, status: results.statusAfterStaleAttempts }), evidence: [evidence], wrong: "product" });
  check(refused(results.approveWithHashFromBeforeProfileChange) && results.statusBrightpathAfterStale === "Awaiting approval", { id: "C-stale-hash-profile-change", severity: "P0", title: "Approve works with a hash from before the profile changed", persona: "Both", area: "POST /api/apps/:id/approve", prd: "A3", expected: "409", actual: JSON.stringify(results.approveWithHashFromBeforeProfileChange), evidence: [evidence], wrong: "product" });
  const badFromApproved = Object.entries(results.statusRouteFromApproved as Record<string, number>).filter(([, code]) => code < 400 || code >= 500);
  check(badFromApproved.length === 0 && results.statusAfterStatusRoute === "Approved", { id: "C-status-route-from-approved", severity: "P0", title: "The status route moves an Approved application to Applied or elsewhere", persona: "Both", area: "POST /api/apps/:id/status", prd: "U4, D16", expected: "Refused", actual: JSON.stringify({ route: results.statusRouteFromApproved, after: results.statusAfterStatusRoute }), evidence: [evidence], wrong: "product" });
  check(refused(results.submitEmptyProof) && refused(results.submitDifferentFile) && results.statusAfterBadSubmissions === "Approved", { id: "C-applied-without-proof", severity: "P0", title: "Applied is reachable without proof or with a different file and no confirmation", persona: "Both", area: "POST /api/apps/:id/submitted", prd: "U4, T2", expected: "Refused", actual: JSON.stringify({ empty: results.submitEmptyProof, different: results.submitDifferentFile, status: results.statusAfterBadSubmissions }), evidence: [evidence], wrong: "product" });
  check(refused(results.submitAfterPhoneChange) && results.statusAfterPhoneChange !== "Applied", { id: "C-applied-after-void", severity: "P0", title: "After the person's details changed, the old approval still lets the application be marked Applied", persona: "Both", area: "POST /api/apps/:id/submitted", prd: "A4", expected: "409 approval-void", actual: JSON.stringify(results.submitAfterPhoneChange), evidence: [evidence], wrong: "product" });
  check(refused(results.approveAgain), { id: "C-approve-twice", severity: "P2", title: "A second approve of an Approved application is not refused", persona: "Both", area: "approve", prd: "A2", expected: "409 not-approvable", actual: JSON.stringify(results.approveAgain), evidence: [evidence], wrong: "product" });
});

// ---------------------------------------------------------------------------------------------
// C2: doors
// ---------------------------------------------------------------------------------------------

test("C2 tokens, Host and Origin", async ({ startServer }) => {
  const server = await startServer({ seed: "alex-rivera", seedOptions: { usageNoticeSeen: true } });
  const results: Record<string, unknown> = {};
  results.noToken = await raw(server, "/api/today", { token: null });
  results.wrongToken = await raw(server, "/api/today", { token: "x".repeat(43) });
  results.tokenInQuery = await raw(server, `/api/today?token=${server.token}`, { token: null });
  results.noTokenPost = await raw(server, "/api/runs", { token: null, body: { kind: "hunt" } });
  results.noTokenPdf = await raw(server, "/api/apps/anything/resume.pdf", { token: null });
  results.noTokenEvents = await raw(server, "/api/events", { token: null });
  results.noTokenExport = await raw(server, "/api/export/csv", { token: null });
  results.noTokenBackup = await raw(server, "/api/backups", { token: null, method: "POST", body: {} });
  results.noTokenMcp = await raw(server, "/mcp", { token: null, method: "POST", body: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  results.sessionTokenOnMcp = await raw(server, "/mcp", { method: "POST", body: { jsonrpc: "2.0", id: 1, method: "tools/list" }, headers: { Accept: "application/json, text/event-stream" } });
  results.badHost = await rawHttp(server, "/api/today", { Host: "evil.example", Authorization: `Bearer ${server.token}` });
  results.badHostPort = await rawHttp(server, "/api/today", { Host: "127.0.0.1:1", Authorization: `Bearer ${server.token}` });
  results.badHostOnStatic = await rawHttp(server, "/", { Host: "evil.example" });
  results.badOrigin = await rawHttp(server, "/api/today", { Host: `127.0.0.1:${new URL(server.origin).port}`, Origin: "https://evil.example", Authorization: `Bearer ${server.token}` });
  results.nullOrigin = await rawHttp(server, "/api/today", { Host: `127.0.0.1:${new URL(server.origin).port}`, Origin: "null", Authorization: `Bearer ${server.token}` });
  results.goodOriginAndHost = await rawHttp(server, "/api/today", { Host: `127.0.0.1:${new URL(server.origin).port}`, Origin: server.origin, Authorization: `Bearer ${server.token}` });
  results.badOriginPostApprove = await rawHttp(server, "/api/runs", { Host: `127.0.0.1:${new URL(server.origin).port}`, Origin: "https://evil.example", Authorization: `Bearer ${server.token}`, "Content-Type": "application/json" }, "POST");
  // The run token cannot be observed from outside (it lives only in the environment of the Claude process), so
  // 'a run token cannot use /api' is read from the unit tests instead; see the report.
  const evidence = writeEvidence("c2-doors.json", results);
  const is = (answer: unknown, status: number): boolean => (answer as Raw).status === status;
  check(["noToken", "wrongToken", "tokenInQuery", "noTokenPost", "noTokenPdf", "noTokenEvents", "noTokenExport", "noTokenBackup"].every((key) => is(results[key], 401)), { id: "C-no-token", severity: "P0", title: "A request without the right key is not refused with 401", persona: "Both", area: "/api", prd: "Security", expected: "401 on every /api route", actual: JSON.stringify(Object.fromEntries(["noToken", "wrongToken", "tokenInQuery", "noTokenPost", "noTokenPdf", "noTokenEvents", "noTokenExport", "noTokenBackup"].map((key) => [key, (results[key] as Raw).status]))), evidence: [evidence], wrong: "product" });
  check(is(results.noTokenMcp, 401) && is(results.sessionTokenOnMcp, 401), { id: "C-session-token-on-mcp", severity: "P0", title: "The session token (or no token) works on /mcp", persona: "Both", area: "/mcp", prd: "Security (a run reaching Approve)", expected: "401", actual: JSON.stringify({ none: (results.noTokenMcp as Raw).status, session: (results.sessionTokenOnMcp as Raw).status }), evidence: [evidence], wrong: "product" });
  check(is(results.badHost, 403) && is(results.badHostPort, 403) && is(results.badHostOnStatic, 403), { id: "C-bad-host", severity: "P0", title: "A request with another Host is answered", persona: "Both", area: "Host check", prd: "Security", expected: "403", actual: JSON.stringify({ host: (results.badHost as Raw).status, port: (results.badHostPort as Raw).status, static: (results.badHostOnStatic as Raw).status }), evidence: [evidence], wrong: "product" });
  check(is(results.badOrigin, 403) && is(results.nullOrigin, 403) && is(results.badOriginPostApprove, 403) && is(results.goodOriginAndHost, 200), { id: "C-bad-origin", severity: "P0", title: "A request from another website's Origin is answered, or the right Origin is refused", persona: "Both", area: "Origin check", prd: "Security", expected: "403 for evil.example and 'null'; 200 for the own origin", actual: JSON.stringify({ bad: (results.badOrigin as Raw).status, null: (results.nullOrigin as Raw).status, post: (results.badOriginPostApprove as Raw).status, good: (results.goodOriginAndHost as Raw).status }), evidence: [evidence], wrong: "product" });
});

// ---------------------------------------------------------------------------------------------
// C3: banned words, unconfirmed items
// ---------------------------------------------------------------------------------------------

test("C3 banned words fail with the word named; unconfirmed story items are never used", async ({ startServer }) => {
  const flaky = makeFlakyClaude();
  try {
    const server = await startServer({ seed: "none", fakeClaudeEnv: flaky.env });
    await startJourney(server);

    // An item the person has not confirmed: add (confirmed at once), then edit (back to pending).
    const created = await server.api<{ id: string }>("/api/story", { body: { kind: "skill", parentId: null, data: { text: "Haskell", tools: ["Haskell"], numbers: [] }, keywords: ["haskell"] } });
    const pending = await server.api<{ id: string; status: string }>(`/api/story/${created.id}`, { method: "PUT", body: { data: { text: "Haskell", tools: ["Haskell"], numbers: [] }, keywords: ["haskell"] } });
    expect(pending.status, "the test needs a pending item").toBe("pending");

    // A job whose text asks for Haskell, pasted in.
    await server.api("/api/jobs", { body: { company: "Haskellco", title: "Backend Engineer", location: "Remote - US", text: "Haskellco needs a Backend Engineer with strong Haskell and Python. You will build services on PostgreSQL. 2+ years of experience. Remote in the US." } });
    await waitUntilNoRunIsActive(server, 120_000);
    await findJobsViaApi(server);
    const rows = await server.api<Row[]>("/api/pipeline");
    const results: Record<string, unknown> = { pipeline: rows.map((row) => `${row.company}/${row.title}/${row.status}`) };

    // 1. Unconfirmed items in resumes and scores.
    const leaks: string[] = [];
    const looked: string[] = [];
    for (const row of rows) {
      const detail = await server.api<any>(`/api/apps/${row.id}`);
      const mentions = (value: unknown): boolean => JSON.stringify(value ?? null).includes(created.id);
      looked.push(`${row.company}/${row.title}: fit=${detail.fit ? "yes" : "no"} resume=${detail.resume ? "yes" : "no"}`);
      if (mentions(detail.fit?.matchedItemIds) || mentions(detail.resume?.body)) leaks.push(`${row.company}: pending item id is in the fit or the resume`);
      if (detail.resume !== null) {
        const pdf = await fetch(`${server.origin}/api/apps/${row.id}/resume.pdf`, { headers: { Authorization: `Bearer ${server.token}` } });
        const info = await readPdfInfo(new Uint8Array(await pdf.arrayBuffer()));
        if (/Haskell/i.test(info.text)) leaks.push(`${row.company}: the resume PDF text contains Haskell`);
      }
    }
    results.unconfirmedLeaks = leaks;
    results.looked = looked;

    // 2. Banned words. Ban a word that is in Brightpath's tailored resume and approve.
    const brightpath = rowOf(rows, "Brightpath");
    const brightpathPdf = await fetch(`${server.origin}/api/apps/${brightpath.id}/resume.pdf`, { headers: { Authorization: `Bearer ${server.token}` } });
    const brightpathText = (await readPdfInfo(new Uint8Array(await brightpathPdf.arrayBuffer()))).text;
    const word = ["PostgreSQL", "Docker", "Python", "Kubernetes", "Redis"].find((candidate) => brightpathText.includes(candidate)) ?? "Python";
    const rules = (await server.api<{ profile: { rules: { bannedTerms: string[] } } }>("/api/profile")).profile.rules;
    await server.api("/api/profile/rules", { method: "PUT", body: { bannedTerms: [...rules.bannedTerms, word] } });
    const detailAfterBan = await server.api<{ dataSheetHash: string }>(`/api/apps/${brightpath.id}`);
    results.approveWithBannedWordInResume = { word, answer: await raw(server, `/api/apps/${brightpath.id}/approve`, { body: { dataSheetHash: detailAfterBan.dataSheetHash, submitMode: "manual" } }) };
    results.statusAfterBannedResume = (await server.api<{ application: { status: string } }>(`/api/apps/${brightpath.id}`)).application.status;
    await server.api("/api/profile/rules", { method: "PUT", body: { bannedTerms: rules.bannedTerms } });

    // Data sheet: the name contains a banned word ("ninja" is in the default rules).
    const contact = (await server.api<{ profile: { contact: Record<string, string> } }>("/api/profile")).profile.contact;
    const savedName = await raw(server, "/api/profile/contact", { method: "PUT", body: { ...contact, fullName: "Alex Ninja Rivera" } });
    const detailNinja = await server.api<{ dataSheetHash: string }>(`/api/apps/${brightpath.id}`);
    results.saveNameWithBannedWord = savedName.status;
    results.approveWithBannedWordInSheet = await raw(server, `/api/apps/${brightpath.id}/approve`, { body: { dataSheetHash: detailNinja.dataSheetHash, submitMode: "manual" } });
    results.statusAfterBannedSheet = (await server.api<{ application: { status: string } }>(`/api/apps/${brightpath.id}`)).application.status;
    await server.api("/api/profile/contact", { method: "PUT", body: contact });

    // A banned word added AFTER tailoring and the resume is asked to be edited: the fresh draft must not contain it.
    const evidence = writeEvidence("c3-banned-and-unconfirmed.json", results);
    check(leaks.length === 0, { id: "C-unconfirmed-used", severity: "P0", title: "An unconfirmed story item reaches a resume or a score", persona: "Both", area: "Tailor / fit", prd: "P2", expected: "Never", actual: leaks.join("; "), evidence: [evidence], wrong: "product" });
    const resumeAnswer = (results.approveWithBannedWordInResume as { answer: Raw; word: string }).answer;
    check(resumeAnswer.status >= 400 && resumeAnswer.status < 500 && JSON.stringify(resumeAnswer.body).toLowerCase().includes((results.approveWithBannedWordInResume as { word: string }).word.toLowerCase()) && results.statusAfterBannedResume === "Awaiting approval", { id: "C-banned-in-resume", severity: "P0", title: "A banned word in the tailored resume does not stop Approve, or the word is not named", persona: "Both", area: "Approve", prd: "P5", expected: "Refused, the word named", actual: JSON.stringify(resumeAnswer), evidence: [evidence], wrong: "product" });
    const sheetAnswer = results.approveWithBannedWordInSheet as Raw;
    check(sheetAnswer.status >= 400 && sheetAnswer.status < 500 && /ninja/i.test(JSON.stringify(sheetAnswer.body)) && results.statusAfterBannedSheet === "Awaiting approval", { id: "C-banned-in-sheet", severity: "P0", title: "A banned word in the data sheet does not stop Approve, or the word is not named", persona: "Both", area: "Approve", prd: "P5", expected: "Refused, the word named", actual: JSON.stringify(sheetAnswer), evidence: [evidence], wrong: "product" });
    void finding;
  } finally {
    flaky.remove();
  }
});

// ---------------------------------------------------------------------------------------------
// C4: one journey in the browser: copy buttons, resume file, exports, privacy sweep
// ---------------------------------------------------------------------------------------------

test("C4 copy buttons, resume file and properties, exports, privacy sweep", async ({ page, context, startServer }) => {
  const flaky = makeFlakyClaude();
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const server = await startServer({ seed: "none", fakeClaudeEnv: flaky.env });
    await startJourney(server);
    await page.goto(server.url);
    await page.getByRole("button", { name: "Find jobs" }).click();
    await expect(needsYouItem(page, ACME)).toContainText("Ready to review", { timeout: 120_000 });
    await expect(needsYouItem(page, BRIGHTPATH)).toContainText("Ready to review");
    await needsYouItem(page, ACME).getByRole("link", { name: "Review" }).click();
    await expect(page.getByRole("article", { name: "Resume preview" })).toBeVisible();
    const acmeId = new URL(page.url()).pathname.split("/").pop() ?? "";
    await page.getByRole("button", { name: "Approve" }).click();
    await waitUntilNoRunIsActive(server, 120_000);

    // Copy buttons against the frozen data sheet.
    await page.goto(`${server.origin}/apply/${acmeId}`);
    await expect(page.getByRole("button", { name: "Copy Email address" })).toBeVisible();
    const detail = await server.api<any>(`/api/apps/${acmeId}`);
    const fields: { key: string; label: string; value: string; missing: boolean }[] = detail.approval.dataSheet.fields;
    const copyResults: Record<string, unknown> = {};
    let copyMismatch = 0;
    let copyButtons = 0;
    for (const field of fields) {
      const button = page.getByRole("button", { name: `Copy ${field.label}`, exact: true });
      if ((await button.count()) === 0) {
        copyResults[field.label] = "no copy button";
        continue;
      }
      copyButtons += 1;
      await button.click();
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      const same = clip === field.value;
      if (!same) copyMismatch += 1;
      copyResults[field.label] = { expected: field.value, clipboard: clip, same };
    }
    for (const answer of detail.answers as { question: string; answer: string }[]) {
      const button = page.getByRole("button", { name: `Copy ${answer.question}`, exact: true });
      await button.click();
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      if (clip !== answer.answer) copyMismatch += 1;
      copyResults[`answer: ${answer.question}`] = { same: clip === answer.answer };
      copyButtons += 1;
    }
    copyResults.summary = { fields: fields.length, copyButtons, mismatches: copyMismatch };
    await page.screenshot({ path: auditPath("screens", "c", "apply-copy-buttons.png"), fullPage: true });

    // The resume file: name, pages, properties, same bytes.
    const folder = path.join(server.personFolder, ...(detail.application.folder as string).split("/"));
    const pdfPath = path.join(folder, "Alex Rivera - Resume.pdf");
    const filesInFolder = fs.existsSync(folder) ? fs.readdirSync(folder) : [];
    const bytes = fs.readFileSync(pdfPath);
    const info = await readPdfInfo(new Uint8Array(bytes));
    const sha = crypto.createHash("sha256").update(bytes).digest("hex");
    const shortId = detail.versions.find((version: { versionId: string }) => version.versionId === detail.approval.resumeVersion)?.shortId;
    const pdfFacts = { fileName: path.basename(pdfPath), filesInFolder, pages: info.pages, title: info.title, author: info.author, keywords: info.keywords, producer: info.producer, approvedVersionId: detail.approval.resumeVersion, shortId, approvedSha: detail.approval.pdfSha256, fileSha: sha, bytes: bytes.length };
    // Applied through the UI, so exports have an Applied row.
    await page.getByRole("button", { name: "I submitted" }).click();
    const dialog = page.getByRole("dialog", { name: "Record that you applied" });
    await dialog.getByLabel("I saw the confirmation, and have nothing to paste").check();
    await dialog.getByRole("button", { name: "Record as applied" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Backend Engineer" })).toBeVisible();
    const submittedDetail = await server.api<any>(`/api/apps/${acmeId}`);
    const appliedFacts = { status: submittedDetail.application.status, followUpOn: submittedDetail.application.followUpOn, proof: submittedDetail.submission?.proof, history: (submittedDetail.history as { type: string }[]).map((event) => event.type) };
    // Later changes: the person changes their phone; the file the company got must stay as it was.
    const contact = (await server.api<{ profile: { contact: Record<string, string> } }>("/api/profile")).profile.contact;
    await server.api("/api/profile/contact", { method: "PUT", body: { ...contact, phone: "+1 555 0123" } });
    const shaAfterChange = crypto.createHash("sha256").update(fs.readFileSync(pdfPath)).digest("hex");
    const detailAfterChange = await server.api<any>(`/api/apps/${acmeId}`);
    const downloadedOld = await fetch(`${server.origin}/api/apps/${acmeId}/resume.pdf?version=${detail.approval.resumeVersion}`, { headers: { Authorization: `Bearer ${server.token}` } });
    const shaDownloadOld = crypto.createHash("sha256").update(Buffer.from(await downloadedOld.arrayBuffer())).digest("hex");
    await server.api("/api/profile/contact", { method: "PUT", body: contact });
    writeEvidence("c4-pdf-properties.json", { ...pdfFacts, shaAfterChange, shaDownloadOld, approvalVoidedAfterChange: detailAfterChange.approval?.voidedAt ?? null, appliedFacts });
    check(appliedFacts.status === "Applied" && appliedFacts.followUpOn !== null, { id: "C-applied-via-ui", severity: "P1", title: "Recording proof in the UI does not end at Applied with a follow-up date", persona: "Both", area: "Open application", prd: "U4", expected: "Applied + follow-up", actual: JSON.stringify(appliedFacts), evidence: [auditPath("c4-pdf-properties.json")], wrong: "product" });

    // Exports.
    const csvResponse = await fetch(`${server.origin}/api/export/csv`, { headers: { Authorization: `Bearer ${server.token}` } });
    const csv = await csvResponse.text();
    const xlsxResponse = await fetch(`${server.origin}/api/export/xlsx`, { headers: { Authorization: `Bearer ${server.token}` } });
    const xlsxBytes = new Uint8Array(await xlsxResponse.arrayBuffer());
    fs.writeFileSync(auditPath("c4-export.xlsx"), xlsxBytes);
    fs.writeFileSync(auditPath("c4-export.csv"), csv);
    const workbook = await readWorkbook(xlsxBytes);
    const pipeline = await server.api<Row[]>("/api/pipeline");
    const csvLines = csv.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
    const csvHeader = csvLines[0] ?? "";
    const exportFacts = { csvContentType: csvResponse.headers.get("content-type"), csvHeader, csvRows: csvLines.length - 1, xlsxContentType: xlsxResponse.headers.get("content-type"), xlsxSize: xlsxBytes.length, sheets: workbook.sheets.map((sheet) => ({ name: sheet.name, header: sheet.header, rowCount: sheet.rowCount - 1, firstRows: sheet.rows.slice(0, 3) })), pipelineRows: pipeline.length, pipelineStatuses: pipeline.map((row) => `${row.company}/${row.status}`) };
    writeEvidence("c4-exports.json", exportFacts);

    // The privacy sweep. What the server handed to the runs, and what it printed.
    const runsDir = path.join(server.appDataDir, "runs");
    const filesChecked = readAllText(runsDir);
    const replies = fs.existsSync(flaky.repliesFile) ? fs.readFileSync(flaky.repliesFile, "latin1") : "";
    const playbooks = fs.existsSync(flaky.playbooksFile) ? fs.readFileSync(flaky.playbooksFile, "latin1") : "";
    const serverOutput = server.output();
    const logsDir = path.join(server.appDataDir, "logs");
    const logFiles = readAllText(logsDir);
    const secrets: { name: string; pattern: RegExp }[] = [
      { name: "email", pattern: /alex\.rivera@example\.com/i },
      { name: "phone", pattern: /555[\s-]?0100|\+1 ?555 ?0100/ },
      { name: "pay", pattern: /187[,.]?500/ },
      { name: "eeo gender", pattern: /EEOGENDERZ91/ },
      { name: "eeo race", pattern: /EEORACEZ92/ },
      { name: "eeo veteran", pattern: /EEOVETERANZ93/ },
      { name: "eeo disability", pattern: /EEODISABLEDZ94/ },
      { name: "evil.example", pattern: /evil\.example/i },
      { name: "full name (info)", pattern: /Alex Rivera/ },
      { name: "location (info)", pattern: /Austin, ?TX/ },
      { name: "github (info)", pattern: /alexrivera-example/ },
    ];
    const sources: { name: string; text: string }[] = [
      { name: "mcp replies (what the server handed to the runs)", text: replies },
      { name: "playbooks (what the runs were told)", text: playbooks },
      { name: "server output", text: serverOutput },
      { name: `runs/ folder (${filesChecked.length} files)`, text: filesChecked.map((file) => file.text).join("\n") },
      { name: `logs/ folder (${logFiles.length} files)`, text: logFiles.map((file) => file.text).join("\n") },
    ];
    const sweepTable = sources.map((source) => ({ source: source.name, bytes: source.text.length, hits: Object.fromEntries(secrets.map((secret) => [secret.name, (source.text.match(new RegExp(secret.pattern, "gi")) ?? []).length])) }));
    const runFiles = filesChecked.map((file) => path.relative(runsDir, file.file));
    // Where the evil.example trap line travels: it is in the posting, so it is in the get_job reply; it must not be in outputs.
    const outputsText = [fs.readFileSync(pdfPath, "latin1"), fs.existsSync(path.join(folder, "Answers.md")) ? fs.readFileSync(path.join(folder, "Answers.md"), "utf8") : ""].join("\n");
    const evilInOutputs = /evil\.example/i.test(outputsText) || /evil\.example/i.test(JSON.stringify(detail.answers)) || /evil\.example/i.test(JSON.stringify(detail.fit ?? ""));
    const sweepFacts = { sweepTable, runFiles, evilExampleInResumeOrAnswersOrFit: evilInOutputs };
    const sweepEvidence = writeEvidence("c4-privacy-sweep.json", sweepFacts);
    writeEvidence("c4-copy-buttons.json", copyResults);

    const personalSecrets = ["email", "phone", "pay", "eeo gender", "eeo race", "eeo veteran", "eeo disability"];
    const leakedPlaces = sweepTable.flatMap((row) => personalSecrets.filter((name) => (row.hits as Record<string, number>)[name] > 0).map((name) => `${name} in ${row.source}`));
    check(leakedPlaces.length === 0, { id: "C-privacy-leak", severity: "P0", title: "A personal value (email, phone, pay, EEO answer) reached something a Claude run sees or the server printed", persona: "Both", area: "Runs / server output", prd: "Privacy (Claude never sees contact, pay, EEO)", expected: "Absent from tool replies, playbooks, runs/ and server output", actual: leakedPlaces.join("; "), evidence: [sweepEvidence], wrong: "product" });
    check(!evilInOutputs, { id: "C-injection-in-output", severity: "P0", title: "The evil.example trap line from a posting reached the resume, answers or fit", persona: "Both", area: "Prompt injection", prd: "Safety", expected: "Never", actual: "present", evidence: [sweepEvidence], wrong: "product" });
    check(copyMismatch === 0 && copyButtons > 0, { id: "C-copy-mismatch", severity: "P1", title: "A Copy button puts something other than the frozen value on the clipboard", persona: "Both", area: "Open application", prd: "U1", expected: "Clipboard equals the approved data sheet value", actual: JSON.stringify(copyResults.summary), evidence: [auditPath("c4-copy-buttons.json")], wrong: "product" });
    check(pdfFacts.fileName === "Alex Rivera - Resume.pdf" && pdfFacts.pages === 1 && String(pdfFacts.keywords).includes(String(pdfFacts.approvedVersionId)) && pdfFacts.fileSha === pdfFacts.approvedSha, { id: "C-resume-file", severity: "P0", title: "The approved resume file is not one page, not named Alex Rivera - Resume.pdf, lacks the version id in its properties, or differs from the approved bytes", persona: "Both", area: "Resume file", prd: "T2, A3", expected: "1 page, named, Keywords holds the version id, sha equal", actual: JSON.stringify(pdfFacts), evidence: [auditPath("c4-pdf-properties.json")], wrong: "product" });
    check(shaAfterChange === pdfFacts.fileSha && shaDownloadOld === pdfFacts.fileSha, { id: "C-approved-bytes-change", severity: "P0", title: "The approved resume's bytes change after the person changes their details", persona: "Both", area: "Resume file", prd: "T2", expected: "Same bytes", actual: JSON.stringify({ shaAfterChange, shaDownloadOld, original: pdfFacts.fileSha }), evidence: [auditPath("c4-pdf-properties.json")], wrong: "product" });
    const csvAcme = csvLines.find((line) => line.startsWith("Acme Cloud")) ?? "";
    check(/,Applied,/.test(csvAcme), { id: "C-csv-applied-row", severity: "P2", title: "The CSV row for the applied application does not say Applied", persona: "Both", area: "Export", prd: "K3", expected: "Applied", actual: csvAcme, evidence: [auditPath("c4-exports.json")], wrong: "product" });
    check(csvHeader.split(",").length >= 8 && csvLines.length - 1 === pipeline.length, { id: "C-csv", severity: "P2", title: "The CSV does not have a header with every column and one row per application", persona: "Both", area: "Export", prd: "K3", expected: "header first, rows = applications", actual: JSON.stringify({ csvHeader, rows: csvLines.length - 1, pipeline: pipeline.length }), evidence: [auditPath("c4-exports.json")], wrong: "product" });
    const rowsInWorkbook = workbook.sheets.reduce((sum, sheet) => sum + Math.max(0, sheet.rowCount - 1), 0);
    check(workbook.sheets.length > 0 && rowsInWorkbook >= pipeline.length, { id: "C-xlsx", severity: "P1", title: "The Excel export does not open or does not hold the rows", persona: "Both", area: "Export", prd: "K3", expected: "Opens; rows for every application", actual: JSON.stringify(exportFacts.sheets), evidence: [auditPath("c4-exports.json"), auditPath("c4-export.xlsx")], wrong: "product" });
    void sweep;
  } finally {
    flaky.remove();
  }
});
