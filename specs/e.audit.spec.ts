// Section E: docs and first run. H5 (the demo commands set no JOBGOBLIN_APP_DATA, so the database goes to
// %APPDATA%\Jobgoblin) is reproduced SAFELY: the server is started with APPDATA pointing at a temp folder and no
// JOBGOBLIN_APP_DATA, and the test only looks at where the database lands. The real %APPDATA%\Jobgoblin is only
// stat'ed (modified times), never read. H6 is a set of doc-versus-reality checks. The guide's words are compared
// with the dashboard's own translation files.
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect } from "./auditFixtures";
import { removeDir, tempDir } from "./helpers";
import { writeEvidence } from "./common";
import { check } from "./record";
import { DEMO_FEEDS_DIR, FAKE_CLAUDE_CLI, REPO_ROOT, SERVER_BUNDLE } from "../support/server";

function statOf(file: string): { exists: boolean; mtime?: string; size?: number } {
  try {
    const stat = fs.statSync(file);
    return { exists: true, mtime: stat.mtime.toISOString(), size: stat.size };
  } catch {
    return { exists: false };
  }
}

const REAL_APPDATA = path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Jobgoblin");

test("H5: the README's demo command, with no JOBGOBLIN_APP_DATA, puts the database in %APPDATA%\\Jobgoblin", async () => {
  const root = tempDir("h5");
  const fakeRoaming = path.join(root, "Roaming");
  fs.mkdirSync(fakeRoaming, { recursive: true });
  const realFiles = ["jobgoblin.db", "jobgoblin.db-wal", "jobgoblin.db-shm"].map((name) => path.join(REAL_APPDATA, name));
  const before = Object.fromEntries(realFiles.map((file) => [path.basename(file), statOf(file)]));

  // The README's demo environment, exactly: the demo feeds and the fake claude. No JOBGOBLIN_APP_DATA.
  // (JOBGOBLIN_PORT=0 is added so this cannot collide with an app that is already running.)
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    const upper = name.toUpperCase();
    if (value === undefined || upper === "APPDATA" || upper.startsWith("JOBGOBLIN_") || upper.startsWith("FAKE_CLAUDE_")) continue;
    env[name] = value;
  }
  env.APPDATA = fakeRoaming;
  env.JOBGOBLIN_FEED_FIXTURES = DEMO_FEEDS_DIR;
  env.JOBGOBLIN_CLAUDE_COMMAND = JSON.stringify([process.execPath, FAKE_CLAUDE_CLI]);
  env.JOBGOBLIN_PORT = "0";

  // SAFETY GATE: the folder the server will use is APPDATA\Jobgoblin, and APPDATA is ours.
  const willUse = path.join(String(env.APPDATA), "Jobgoblin");
  expect(env.JOBGOBLIN_APP_DATA, "the demo command must leave JOBGOBLIN_APP_DATA unset").toBeUndefined();
  expect(willUse.startsWith(root), "the server must be pointed at a temp folder before it starts").toBe(true);
  expect(willUse.toLowerCase()).not.toBe(REAL_APPDATA.toLowerCase());

  const child = spawn(process.execPath, [SERVER_BUNDLE], { cwd: REPO_ROOT, env: { ...env, JOBGOBLIN_RESOURCES_DIR: REPO_ROOT }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  try {
    await expect.poll(() => /JOBGOBLIN_READY/.test(output), { timeout: 45_000 }).toBe(true);
    const landed = fs.existsSync(willUse) ? fs.readdirSync(willUse) : [];
    const dbLandedInRoaming = landed.includes("jobgoblin.db");
    const afterFiles = Object.fromEntries(realFiles.map((file) => [path.basename(file), statOf(file)]));
    const realUntouched = JSON.stringify(before) === JSON.stringify(afterFiles);
    const evidence = writeEvidence("h5-demo-command-data-location.json", {
      envSetForServer: { APPDATA: env.APPDATA, JOBGOBLIN_APP_DATA: env.JOBGOBLIN_APP_DATA ?? "(not set)" },
      folderTheServerUsed: willUse,
      filesThere: landed,
      dbLandedInRoaming,
      realAppDataBeforeAfter: { before, after: afterFiles, unchanged: realUntouched },
      note: "The server's default is %APPDATA%\\Jobgoblin (packages/server/src/startOptions.ts:79-83). A person who runs the README demo command on a machine that already has real data would open the real database. The Electron app resolves appData from the operating system, not from the APPDATA variable, so it was NOT started this way.",
    });
    check(!dbLandedInRoaming, {
      id: "H5", severity: "P1",
      title: "The README and guide demo commands do not set JOBGOBLIN_APP_DATA, so demo mode opens (and writes to) the real %APPDATA%\\Jobgoblin database",
      persona: "Both", area: "README 'Run it' / USER_GUIDE 'Demo mode' / startOptions", prd: "Privacy / data loss (demo data mixing with real data)",
      expected: "Demo mode uses its own data folder, or the docs say to set JOBGOBLIN_APP_DATA",
      actual: `With APPDATA=<temp> and JOBGOBLIN_APP_DATA unset the server created ${willUse}\\jobgoblin.db. With the real APPDATA that is the owner's real database (docs/USER_GUIDE.md:60 even says so). The real database files were not touched by this test (unchanged: ${realUntouched}).`,
      evidence: [evidence], suspectedFile: "packages/server/src/startOptions.ts:20,79-83; README.md 'Run it'; docs/USER_GUIDE.md:51-60", wrong: "product",
    });
  } finally {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // already gone
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
    removeDir(root);
  }
});

test("H6 and docs: versions, branch, counts, and the words in the guide against the screens", async () => {
  const facts: Record<string, unknown> = {};
  const readme = fs.readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");
  const guide = fs.readFileSync(path.join(REPO_ROOT, "docs", "USER_GUIDE.md"), "utf8");
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as { engines: { node: string }; packageManager: string };
  const ci = fs.existsSync(path.join(REPO_ROOT, ".github", "workflows", "ci.yml")) ? fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8") : "";

  // Node
  facts.readmeNode = /Node (\d+)/.exec(readme)?.[0] ?? null;
  facts.guideNode = /Node ([\d.]+)/.exec(guide)?.[0] ?? null;
  facts.enginesNode = pkg.engines.node;
  facts.ciNode = /node-version:\s*['"]?([\w.]+)/.exec(ci)?.[1] ?? null;
  facts.nodeInUse = process.version;
  const readmeMajor = /Node (\d+)/.exec(readme)?.[1] ?? "";
  const guideMinimum = /Node ([\d.]+)/.exec(guide)?.[1] ?? "";
  check(guideMinimum.startsWith(readmeMajor) && pkg.engines.node.includes(readmeMajor), {
    id: "H6-node", severity: "P3", title: "The README asks for Node 24, the guide and package.json engines allow Node 22.13 or later", persona: "Alex", area: "README vs docs/USER_GUIDE.md vs package.json", prd: "-",
    expected: "One stated minimum", actual: JSON.stringify({ readme: facts.readmeNode, guide: facts.guideNode, engines: facts.enginesNode, ci: facts.ciNode }), evidence: [], suspectedFile: "README.md:21; docs/USER_GUIDE.md:18; package.json:7", wrong: "product",
  });

  // The branch the guide tells people to clone
  let branch = "";
  try {
    branch = execFileSync("git", ["ls-remote", "--heads", "origin", "poc/developer-preview"], { cwd: REPO_ROOT, encoding: "utf8", timeout: 45_000 }).trim();
  } catch (error) {
    branch = `git ls-remote failed: ${String(error).slice(0, 200)}`;
  }
  facts.branchPocDeveloperPreview = branch === "" ? "does not exist on origin" : branch;
  facts.remotes = execFileSync("git", ["remote", "-v"], { cwd: REPO_ROOT, encoding: "utf8" }).split("\n").slice(0, 2);
  check(/refs\/heads\/poc\/developer-preview/.test(branch), {
    id: "H6-branch", severity: "P2", title: "The guide tells new people to clone branch poc/developer-preview, which does not exist on the remote", persona: "Alex", area: "docs/USER_GUIDE.md:32", prd: "The gate: five outside testers",
    expected: "The branch exists, or the guide says which branch to use", actual: String(facts.branchPocDeveloperPreview), evidence: [], suspectedFile: "docs/USER_GUIDE.md:32", wrong: "product",
  });

  // Counts
  const e2eDir = path.join(REPO_ROOT, "e2e");
  const e2eRequire = createRequire(path.join(e2eDir, "package.json"));
  const playwrightCli = e2eRequire.resolve("@playwright/test/cli");
  const listed = execFileSync(process.execPath, [playwrightCli, "test", "--list", "--config", "playwright.config.ts"], { cwd: e2eDir, encoding: "utf8", env: { ...process.env, E2E_SKIP_BUILD: "1" } });
  const total = /Total: (\d+) tests? in (\d+) files?/.exec(listed);
  const chromiumOnly = execFileSync(process.execPath, [playwrightCli, "test", "--list", "--project=chromium", "--config", "playwright.config.ts"], { cwd: e2eDir, encoding: "utf8", env: { ...process.env, E2E_SKIP_BUILD: "1" } });
  const chromiumTotal = /Total: (\d+) tests?/.exec(chromiumOnly)?.[1];
  facts.browserTestsActual = { allProjects: total?.[1], files: total?.[2], chromiumProject: chromiumTotal };
  facts.browserTestsClaimed = /(\d+) browser tests/.exec(guide)?.[1];
  check(String(facts.browserTestsClaimed) === String(total?.[1]) || String(facts.browserTestsClaimed) === String(chromiumTotal), {
    id: "H6-test-count", severity: "P3", title: `The guide says ${String(facts.browserTestsClaimed)} browser tests; the suite lists ${total?.[1]} (${chromiumTotal} in the browser project)`, persona: "Alex", area: "docs/USER_GUIDE.md:162", prd: "-",
    expected: "The real number", actual: JSON.stringify(facts.browserTestsActual), evidence: [], suspectedFile: "docs/USER_GUIDE.md:162", wrong: "product",
  });
  const companies = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "packages", "server", "src", "seed", "companies.json"), "utf8")) as unknown[];
  facts.companiesActual = companies.length;
  facts.companiesClaimed = /about (\d+) companies/.exec(guide)?.[1];
  facts.statusesActual = (fs.readFileSync(path.join(REPO_ROOT, "packages", "schemas", "src", "status.ts"), "utf8").match(/^  "[^"]+",$/gm) ?? []).length;

  // The guide's words against the screens' words.
  const today = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "apps", "dashboard", "src", "i18n", "en", "today.json"), "utf8")) as { needsYou: { kind: Record<string, string> } };
  const common = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "apps", "dashboard", "src", "i18n", "en", "common.json"), "utf8")) as { status: Record<string, string>; actions: Record<string, string> };
  const guideNeedsYou = ["Ready to review", "Long shot", "Question", "Ready to submit", "Follow-up due", "Couldn't tailor", "Run attention"];
  const screenNeedsYou = Object.values(today.needsYou.kind);
  const missingFromScreens = guideNeedsYou.filter((label) => !screenNeedsYou.includes(label));
  facts.needsYouGuide = guideNeedsYou;
  facts.needsYouScreens = screenNeedsYou;
  facts.needsYouInGuideNotOnScreens = missingFromScreens;
  const guideStatuses = ["OA", "Phone screen", "Onsite", "Offer", "Accepted", "Declined", "Rejected", "Ghosted"];
  const statusMismatch = guideStatuses.filter((status) => common.status[status] !== undefined && common.status[status] !== status).map((status) => `${status} -> ${common.status[status]}`);
  facts.statusNamesDifferent = statusMismatch;
  facts.guideSaysRetry = /\bRetry\b/.test(guide);
  facts.screensSayTryAgain = common.actions.tryAgain;
  facts.desktopDialogSaysRetry = fs.readFileSync(path.join(REPO_ROOT, "apps", "desktop", "src", "main.ts"), "utf8").includes("Retry button");
  facts.guideDefaultFolder = /default `Documents\\Jobgoblin`/.test(guide);
  const folderStep = fs.readFileSync(path.join(REPO_ROOT, "apps", "dashboard", "src", "screens", "setup", "steps", "FolderStep.tsx"), "utf8");
  facts.folderStepHasDefaultDocumentsJobgoblin = /Documents.{0,3}Jobgoblin/.test(folderStep);
  const evidence = writeEvidence("e-doc-checks.json", facts);

  check(missingFromScreens.length === 0, {
    id: "E-guide-needs-you", severity: "P2", title: "The guide names Needs-you items that do not exist under those names on screen", persona: "Alex", area: "docs/USER_GUIDE.md:79-86", prd: "-",
    expected: "The guide uses the words on the screen", actual: `Guide: ${missingFromScreens.join("; ")}. Screens: ${screenNeedsYou.join("; ")}`, evidence: [evidence], suspectedFile: "docs/USER_GUIDE.md:79-86 vs apps/dashboard/src/i18n/en/today.json:27-47", wrong: "product",
  });
  check(statusMismatch.length === 0 && !facts.guideSaysRetry, {
    id: "E-guide-words", severity: "P3", title: "The guide says Retry, OA and Onsite where the screens say Try again, Online assessment and Interview round", persona: "Alex", area: "docs/USER_GUIDE.md:86,122 and apps/desktop/src/main.ts:119", prd: "Voice consistency",
    expected: "One set of words", actual: JSON.stringify({ statusMismatch, guideSaysRetry: facts.guideSaysRetry, desktopDialogSaysRetry: facts.desktopDialogSaysRetry, screens: facts.screensSayTryAgain }), evidence: [evidence], suspectedFile: "docs/USER_GUIDE.md; apps/desktop/src/main.ts:119", wrong: "product",
  });
  check(!facts.guideDefaultFolder || facts.folderStepHasDefaultDocumentsJobgoblin === true, {
    id: "E-guide-default-folder", severity: "P3", title: "The guide says the folder defaults to Documents\\Jobgoblin; the Folder step has no default (an empty box, or the chooser opening in Documents)", persona: "Maya", area: "docs/USER_GUIDE.md:60 vs setup step 3", prd: "S4",
    expected: "A real default or no claim", actual: "no default in the Folder step", evidence: [evidence], suspectedFile: "docs/USER_GUIDE.md:60; apps/dashboard/src/components/FolderChooser.tsx:22", wrong: "product",
  });
  expect(facts.companiesActual).toBeGreaterThan(0);
});
