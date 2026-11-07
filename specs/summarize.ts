// Merges AUDIT_DIR/findings.jsonl by id: a finding is "confirmed" when two different runs recorded it, otherwise
// "suspected". Writes AUDIT_DIR/findings-summary.json and prints one line each.
//   node --experimental-strip-types e2e/audit/summarize.ts     (or: pnpm exec tsx e2e/audit/summarize.ts)
import fs from "node:fs";
import path from "node:path";

const dir =
  process.env.AUDIT_DIR ??
  "<home>\\AppData\\Local\\Temp\\claude\\<project>\\859c954c-890e-44a8-9a2c-82528f47ac4a\\scratchpad\\audit";
const lines = fs.readFileSync(path.join(dir, "findings.jsonl"), "utf8").split("\n").filter(Boolean);
const byId = new Map<string, any[]>();
for (const line of lines) {
  const f = JSON.parse(line);
  byId.set(f.id, [...(byId.get(f.id) ?? []), f]);
}
const out = [...byId.entries()].map(([id, list]) => {
  const runs = [...new Set(list.map((f) => f.run))];
  const last = list[list.length - 1];
  return { ...last, runs, status: runs.length >= 2 ? "confirmed" : "suspected" };
});
out.sort((a, b) => String(a.severity).localeCompare(String(b.severity)) || String(a.id).localeCompare(String(b.id)));
fs.writeFileSync(path.join(dir, "findings-summary.json"), JSON.stringify(out, null, 2));
for (const f of out) console.log(`${f.id}\t${f.severity}\t${f.status}\t${f.wrong}\t${f.title}`);
