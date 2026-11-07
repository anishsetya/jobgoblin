// Helpers for the real-Claude journey (Phase 4): the progress file, a run watcher that samples the progress card,
// and a transcript reader that turns a run's transcript.jsonl into numbers. Not a spec.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import type { TestServer } from "../support/server";
import { AUDIT_DIR } from "./paths";

export const REAL_DIR = path.join(AUDIT_DIR, "real");
fs.mkdirSync(REAL_DIR, { recursive: true });

export function progress(line: string): void {
  fs.appendFileSync(path.join(REAL_DIR, "progress.md"), `${new Date().toISOString()} ${line}\n`);
}

export function writeReal(name: string, body: string | object): string {
  const target = path.join(REAL_DIR, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof body === "string" ? body : JSON.stringify(body, null, 2));
  return target;
}

export type RunView = {
  id: string;
  kind: string;
  status: string;
  step: string | null;
  progressDone: number | null;
  progressTotal: number | null;
  outcomeMessage?: string | null;
  model?: string;
};

type Today = { running: RunView[]; needsYou: { kind: string; title: string }[] };

export type Sample = { t: number; runId: string; kind: string; status: string; step: string | null; done: number | null; total: number | null; cardText: string };

export type Watch = {
  label: string;
  startedAt: number;
  endedAt: number;
  samples: Sample[]; // only the polls where something about a run changed
  runIds: string[];
  kinds: string[];
  longestSilentMs: number;
  longestSilentAt: string;
  screenshots: string[];
  sawTimeoutOrFailure: string[];
};

// Polls /api/today every 1.5 s until no run is queued or running for 3 polls in a row. Logs each CHANGE of a run's
// step, status or progress, and the text on the card. Takes a screenshot every shotEveryMs.
export async function watchRuns(
  page: Page,
  server: TestServer,
  label: string,
  options: { maxMs?: number; shotEveryMs?: number; minMs?: number } = {},
): Promise<Watch> {
  const maxMs = options.maxMs ?? 30 * 60_000;
  const shotEveryMs = options.shotEveryMs ?? 60_000;
  const minMs = options.minMs ?? 0;
  const startedAt = Date.now();
  const samples: Sample[] = [];
  const lastKey = new Map<string, string>();
  const runIds = new Set<string>();
  const kinds = new Set<string>();
  const screenshots: string[] = [];
  const failures: string[] = [];
  let lastShot = startedAt;
  let lastChange = startedAt;
  let longest = 0;
  let longestAt = "";
  let quiet = 0;

  while (Date.now() - startedAt < maxMs) {
    let today: Today | undefined;
    try {
      today = await server.api<Today>("/api/today");
    } catch (error) {
      failures.push(`today poll failed: ${String(error).slice(0, 120)}`);
    }
    const now = Date.now();
    if (today !== undefined) {
      const active = today.running.filter((run) => run.status === "queued" || run.status === "running");
      const cardTexts = await page
        .evaluate(() => [...document.querySelectorAll('[data-testid="run-card"]')].map((card) => (card as HTMLElement).innerText.replace(/\s+/g, " ").trim()))
        .catch(() => [] as string[]);
      for (const run of today.running) {
        runIds.add(run.id);
        kinds.add(run.kind);
        const cardText = cardTexts.find((text) => text.length > 0 && (run.step ? text.includes(run.step) : true)) ?? cardTexts.join(" || ");
        const key = `${run.status}|${run.step}|${run.progressDone}|${run.progressTotal}|${cardTexts.join("||")}`;
        if (lastKey.get(run.id) !== key) {
          lastKey.set(run.id, key);
          const gap = now - lastChange;
          if (active.length > 0 && gap > longest) {
            longest = gap;
            longestAt = `${new Date(lastChange).toISOString()} -> ${new Date(now).toISOString()} (before: "${samples[samples.length - 1]?.step ?? ""}")`;
          }
          lastChange = now;
          samples.push({ t: now - startedAt, runId: run.id, kind: run.kind, status: run.status, step: run.step, done: run.progressDone, total: run.progressTotal, cardText });
        }
        if (["failed", "blocked", "interrupted", "cancelled"].includes(run.status)) failures.push(`${run.kind} ${run.id}: ${run.status} ${run.outcomeMessage ?? ""}`);
      }
      if (active.length > 0 && now - lastChange > longest) {
        longest = now - lastChange;
        longestAt = `${new Date(lastChange).toISOString()} -> ongoing`;
      }
      quiet = active.length === 0 && now - startedAt >= minMs ? quiet + 1 : 0;
      if (quiet >= 3) break;
      if (active.length > 0 && now - lastShot >= shotEveryMs) {
        lastShot = now;
        const file = path.join(REAL_DIR, "screens", `${label}-${String(screenshots.length + 1).padStart(2, "0")}.png`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        await page.screenshot({ path: file, fullPage: false }).catch(() => undefined);
        screenshots.push(file);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const watch: Watch = {
    label,
    startedAt,
    endedAt: Date.now(),
    samples,
    runIds: [...runIds],
    kinds: [...kinds],
    longestSilentMs: longest,
    longestSilentAt: longestAt,
    screenshots,
    sawTimeoutOrFailure: [...new Set(failures)],
  };
  writeReal(`watch-${label}.json`, watch);
  return watch;
}

// ---- transcripts ----------------------------------------------------------------------------------------------

export type TranscriptSummary = {
  runId: string;
  kind: string;
  model: string;
  initTools: string[];
  initMcp: unknown;
  toolCalls: { name: string; error: boolean; input?: string }[];
  toolOrder: string[];
  toolCounts: Record<string, number>;
  toolErrors: number;
  submitResumeDraftCalls: number;
  submitResumeDraftErrors: number;
  deniedOrRefused: string[];
  askedPerson: boolean;
  webToolCalls: string[];
  turns: number | null;
  durationMs: number | null;
  durationApiMs: number | null;
  costUsd: number | null;
  usage: unknown;
  isError: boolean | null;
  resultSubtype: string | null;
  resultText: string;
  lines: number;
  firstTs: string | null;
  lastTs: string | null;
};

type Json = Record<string, any>;

export function analyzeRunFolder(folder: string): TranscriptSummary | null {
  const transcript = path.join(folder, "transcript.jsonl");
  if (!fs.existsSync(transcript)) return null;
  const playbook = fs.existsSync(path.join(folder, "PLAYBOOK.md")) ? fs.readFileSync(path.join(folder, "PLAYBOOK.md"), "utf8") : "";
  const kind = /run-kind: (\w+)/.exec(playbook)?.[1] ?? "?";
  const lines = fs.readFileSync(transcript, "utf8").split(/\r?\n/).filter((line) => line.trim() !== "");
  const summary: TranscriptSummary = {
    runId: path.basename(folder),
    kind,
    model: "",
    initTools: [],
    initMcp: null,
    toolCalls: [],
    toolOrder: [],
    toolCounts: {},
    toolErrors: 0,
    submitResumeDraftCalls: 0,
    submitResumeDraftErrors: 0,
    deniedOrRefused: [],
    askedPerson: false,
    webToolCalls: [],
    turns: null,
    durationMs: null,
    durationApiMs: null,
    costUsd: null,
    usage: null,
    isError: null,
    resultSubtype: null,
    resultText: "",
    lines: lines.length,
    firstTs: null,
    lastTs: null,
  };
  const idToName = new Map<string, string>();
  for (const line of lines) {
    let event: Json;
    try {
      event = JSON.parse(line) as Json;
    } catch {
      continue;
    }
    if (event.type === "system" && event.subtype === "init") {
      summary.model = String(event.model ?? "");
      summary.initTools = Array.isArray(event.tools) ? (event.tools as string[]) : [];
      summary.initMcp = event.mcp_servers ?? null;
    } else if (event.type === "assistant") {
      const content = event.message?.content;
      if (Array.isArray(content)) {
        for (const block of content as Json[]) {
          if (block.type === "tool_use") {
            const name = String(block.name);
            idToName.set(String(block.id), name);
            summary.toolCalls.push({ name, error: false, input: JSON.stringify(block.input ?? {}).slice(0, 300) });
            summary.toolOrder.push(name);
            summary.toolCounts[name] = (summary.toolCounts[name] ?? 0) + 1;
            if (/ask_person$/.test(name)) summary.askedPerson = true;
            if (/^(WebFetch|WebSearch)/.test(name)) summary.webToolCalls.push(`${name} ${JSON.stringify(block.input ?? {}).slice(0, 200)}`);
            if (/submit_resume_draft$/.test(name)) summary.submitResumeDraftCalls += 1;
          }
        }
      }
    } else if (event.type === "user") {
      const content = event.message?.content;
      if (Array.isArray(content)) {
        for (const block of content as Json[]) {
          if (block.type === "tool_result") {
            const name = idToName.get(String(block.tool_use_id)) ?? "?";
            const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
            const refused = /permission|not allowed|denied|doesn't want to proceed|not available/i.test(text) && block.is_error === true;
            const logicalError = /"ok"\s*:\s*false/.test(text);
            if (block.is_error === true || logicalError) {
              summary.toolErrors += 1;
              const call = [...summary.toolCalls].reverse().find((entry) => entry.name === name && !entry.error);
              if (call) call.error = true;
              if (/submit_resume_draft$/.test(name)) summary.submitResumeDraftErrors += 1;
              if (refused) summary.deniedOrRefused.push(`${name}: ${text.slice(0, 200)}`);
            }
          }
        }
      }
    } else if (event.type === "result") {
      summary.turns = typeof event.num_turns === "number" ? event.num_turns : null;
      summary.durationMs = typeof event.duration_ms === "number" ? event.duration_ms : null;
      summary.durationApiMs = typeof event.duration_api_ms === "number" ? event.duration_api_ms : null;
      summary.costUsd = typeof event.total_cost_usd === "number" ? event.total_cost_usd : null;
      summary.usage = event.usage ?? null;
      summary.isError = typeof event.is_error === "boolean" ? event.is_error : null;
      summary.resultSubtype = typeof event.subtype === "string" ? event.subtype : null;
      summary.resultText = typeof event.result === "string" ? event.result : "";
    }
  }
  const stat = fs.statSync(transcript);
  summary.lastTs = stat.mtime.toISOString();
  summary.firstTs = stat.birthtime.toISOString();
  return summary;
}

export function analyzeAllRuns(appDataDir: string): TranscriptSummary[] {
  const runsDir = path.join(appDataDir, "runs");
  if (!fs.existsSync(runsDir)) return [];
  const all: TranscriptSummary[] = [];
  for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const summary = analyzeRunFolder(path.join(runsDir, entry.name));
    if (summary) all.push(summary);
  }
  return all.sort((a, b) => (a.firstTs ?? "").localeCompare(b.firstTs ?? ""));
}

export function copyRunFolders(appDataDir: string, into: string): void {
  const runsDir = path.join(appDataDir, "runs");
  if (!fs.existsSync(runsDir)) return;
  for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const target = path.join(into, entry.name);
    fs.mkdirSync(target, { recursive: true });
    for (const file of fs.readdirSync(path.join(runsDir, entry.name), { withFileTypes: true })) {
      if (file.isFile()) fs.copyFileSync(path.join(runsDir, entry.name, file.name), path.join(target, file.name));
    }
  }
}

export function countRunFolders(appDataDir: string): number {
  const runsDir = path.join(appDataDir, "runs");
  if (!fs.existsSync(runsDir)) return 0;
  return fs.readdirSync(runsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
}

// Searches every file under a folder (and an optional extra text) for the given needles. Returns hits by file.
export function searchTree(root: string, needles: string[]): { file: string; needle: string; count: number }[] {
  const hits: { file: string; needle: string; count: number }[] = [];
  function walk(folder: string): void {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const text = fs.readFileSync(full, "utf8");
        for (const needle of needles) {
          const count = text.split(needle).length - 1;
          if (count > 0) hits.push({ file: path.relative(root, full), needle, count });
        }
      }
    }
  }
  if (fs.existsSync(root)) walk(root);
  return hits;
}
