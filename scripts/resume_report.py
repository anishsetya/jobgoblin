"""Build applications/INDEX.html — one page showing, for every application folder:
which resume was made for it (content-hash version id + PDF link), how it differs from master, its fit score,
whether it was submitted (git tag), and — if it was not tailored — exactly why.

Also prints Sheet-ready 'Resume version' / 'Resume file' values aligned to a list of Sheet IDs:
    resume_report.py --sheet-ids ids.json      (ids.json = JSON array of Applications!A values, in row order)

Usage: .venv/Scripts/python.exe scripts/resume_report.py [--open]
Pure code: no LLM cost. Safe to run any time; the HTML is regenerated from the folders.
"""
from __future__ import annotations

import hashlib
import html
import json
import re
import subprocess
import sys
import webbrowser
from datetime import datetime
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
APPS = ROOT / "applications"
MASTER = ROOT / "resume" / "master.yaml"
CONFIG = yaml.safe_load((ROOT / "config.yaml").read_text(encoding="utf-8"))
MIN_FIT = CONFIG["daily"]["min_fit"]
MAX_TAILORED = CONFIG["daily"]["max_tailored"]


def read_json(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8-sig")) if p.exists() else {}


def version_id(path: Path) -> str:
    """Same content -> same id. Comments and blank lines are ignored, so only real changes make a new id."""
    body = "\n".join(l.rstrip() for l in path.read_text(encoding="utf-8").splitlines()
                     if l.strip() and not l.lstrip().startswith("#"))
    return "r-" + hashlib.sha1(body.encode()).hexdigest()[:6]


def sections(resume_yaml: Path) -> dict:
    cv = yaml.safe_load(resume_yaml.read_text(encoding="utf-8"))["cv"]
    out = {"headline": cv.get("headline", ""), "bullets": {}, "skills": []}
    for name, entries in cv["sections"].items():
        for e in entries:
            if "highlights" in e:
                key = e.get("company") or e.get("name") or name
                out["bullets"][key] = list(e["highlights"])
            elif "label" in e:
                out["skills"].append(e["label"])
    return out


def diff_vs_master(master: dict, v: dict) -> list[str]:
    notes = []
    if v["headline"] != master["headline"]:
        notes.append(f"Headline: “{v['headline']}”")
    for key, base in master["bullets"].items():
        cur = v["bullets"].get(key)
        if cur is None:
            notes.append(f"{key}: whole entry removed")
            continue
        dropped = [b for b in base if b not in cur]
        added = [b for b in cur if b not in base]
        if added:
            notes.append(f"{key}: {len(added)} bullet(s) reworded/added")
        removed_only = max(0, len(dropped) - len(added))
        if removed_only:
            notes.append(f"{key}: {removed_only} bullet(s) dropped")
        if not dropped and not added and cur != base:
            notes.append(f"{key}: bullets reordered")
    if v["skills"] != master["skills"]:
        notes.append("Skills: " + " → ".join(v["skills"]))
    return notes or ["Identical to master (no changes)"]


def diff_short(master: dict, v: dict) -> str:
    """One-cell summary of how a tailored resume differs from master."""
    parts = []
    if v["headline"] != master["headline"]:
        parts.append("headline")
    for key, base in master["bullets"].items():
        cur = v["bullets"].get(key)
        label = key.split(" (")[0]
        if cur is None:
            parts.append(f"{label} removed")
            continue
        added = [b for b in cur if b not in base]
        dropped = [b for b in base if b not in cur]
        if added:
            parts.append(f"{label}: {len(added)} reworded")
        if len(dropped) > len(added):
            parts.append(f"{label}: {len(dropped) - len(added)} dropped")
        if not added and not dropped and cur != base:
            parts.append(f"{label}: reordered")
    if v["skills"] != master["skills"]:
        parts.append("skills reordered")
    return "; ".join(parts) or "same as master"


def bullet_labels() -> dict[str, str]:
    bank = yaml.safe_load((ROOT / "profile" / "bullet_bank.yaml").read_text(encoding="utf-8"))["bullets"]
    return {b["id"]: b.get("short", b["id"]) for b in bank}


def clip(text: str, n: int) -> str:
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def git_tags() -> dict[str, str]:
    try:
        out = subprocess.run(["git", "tag", "-l", "app/*"], cwd=ROOT, capture_output=True, text=True).stdout
    except OSError:
        return {}
    return {t: t for t in out.split()}


def why_not(fit: dict, tailored: bool) -> str:
    if tailored:
        return ""
    score = fit.get("score") or 0
    notes = (fit.get("notes") or "").strip()
    short = (notes.split(". ")[0] + ".") if notes else ""
    rec = fit.get("apply_recommendation")
    if rec == "skip" and score == 0:
        return f"Hard skip (5+ years, active clearance, closed posting, region rule, excluded role or not software). {short}"
    if rec == "long-shot":
        return f"Long shot (fit {score}): listed for you, tailored only if you ask. {short}"
    if score < MIN_FIT:
        return f"Fit {score} is below the {MIN_FIT} needed to tailor. {short}"
    return f"Fit {score} qualifies, but it wasn't tailored yet (daily cap of {MAX_TAILORED} or waiting for the next run). {short}"


def collect() -> list[dict]:
    master = sections(MASTER)
    tags = git_tags()
    labels = bullet_labels()
    rows = []
    for d in sorted(APPS.iterdir()):
        fit = read_json(d / "fit.json")
        if not fit:
            continue
        resume = d / "resume.yaml"
        pdf = d / "out" / "Resume.pdf"
        sub = read_json(d / "submitted.json")
        tailored = resume.exists() and pdf.exists()
        tag = next((t for t in tags if d.name.split("_", 2)[1] in t), "")
        rows.append({
            "folder": d.name, "job_id": fit.get("job_id", ""), "company": fit.get("company", ""),
            "title": fit.get("title", ""), "track": fit.get("track", ""), "region": fit.get("region", ""),
            "score": fit.get("score") or 0, "rec": fit.get("apply_recommendation", ""), "url": fit.get("url", ""),
            "tailored": tailored, "version": version_id(resume) if tailored else "",
            "pdf": f"{d.name}/out/Resume.pdf" if tailored else "",
            "diff": diff_vs_master(master, sections(resume)) if tailored else [],
            "bullets": fit.get("best_bullets", []), "gaps": fit.get("gaps", []),
            "submitted": bool(sub), "submitted_at": sub.get("submitted_at", ""), "tag": tag if sub else "",
            "answers": (d / "answers.md").exists(), "why_not": why_not(fit, tailored), "notes": fit.get("notes", ""),
            "covered": fit.get("covered", []),
            "bullet_labels": [labels.get(b, b) for b in fit.get("best_bullets", [])],
            "diff_short": diff_short(master, sections(resume)) if tailored else "",
        })
    return rows


def state(r: dict) -> tuple[str, str]:
    if r["submitted"]:
        return "Submitted", "ok"
    if r["tailored"]:
        return "Resume ready · awaiting your approval", "ready"
    return "Not tailored", "skip"


def build_html(rows: list[dict]) -> str:
    esc = html.escape
    versions = {}
    for r in rows:
        if r["version"]:
            versions.setdefault(r["version"], []).append(r["company"])
    tailored = [r for r in rows if r["tailored"]]
    skipped = [r for r in rows if not r["tailored"]]
    tailored.sort(key=lambda r: -r["score"])
    skipped.sort(key=lambda r: -r["score"])

    def card(r: dict) -> str:
        label, cls = state(r)
        diff = "".join(f"<li>{esc(x)}</li>" for x in r["diff"])
        pdf = f'<a class="btn" href="{esc(r["pdf"])}" target="_blank">Open resume PDF</a>' if r["pdf"] else ""
        job = f'<a href="{esc(r["url"])}" target="_blank">job posting</a>' if r["url"] else ""
        same = len(versions.get(r["version"], [])) if r["version"] else 0
        return f"""<details class="card {cls}"><summary>
<span class="score">{r['score']}</span><b>{esc(r['company'])}</b> — {esc(r['title'])}
<span class="tag">{esc(r['track'])} · {esc(r['region'])}</span>
<span class="state {cls}">{esc(label)}</span>{f'<code>{esc(r["version"])}</code>' if r['version'] else ''}</summary>
<div class="body">{pdf} {job} <span class="muted">folder: {esc(r['folder'])}</span>
{f'<p><b>Submitted</b> {esc(r["submitted_at"])} · git tag <code>{esc(r["tag"])}</code></p>' if r['submitted'] else ''}
{f'<p><b>How this resume differs from master</b> (version <code>{esc(r["version"])}</code>{", shared with " + str(same - 1) + " other application(s)" if same > 1 else ""}):</p><ul>{diff}</ul>' if r['tailored'] else f'<p><b>Why not tailored:</b> {esc(r["why_not"])}</p>'}
{f'<p><b>Strongest bullets used:</b> {esc(", ".join(r["bullets"]))}</p>' if r['bullets'] else ''}
{f'<p><b>Gaps the analysis found:</b> {esc("; ".join(r["gaps"]))}</p>' if r['gaps'] else ''}
<p class="muted">{esc(r['notes'])}</p></div></details>"""

    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Applications Resume Index</title><style>
:root{{--bg:#fafaf7;--fg:#1c1c1a;--mut:#6b6b66;--card:#fff;--line:#e4e2da;--ok:#1a7f4b;--ready:#1f5fbf;--skip:#8a8a84}}
@media(prefers-color-scheme:dark){{:root{{--bg:#161614;--fg:#ecebe6;--mut:#9a9a93;--card:#1f1f1c;--line:#34332e;--ok:#4cc38a;--ready:#6ea8ff;--skip:#8a8a84}}}}
body{{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0 auto;max-width:980px;padding:24px 16px 64px}}
h1{{font-size:22px;margin:0 0 4px}} h2{{font-size:17px;margin:32px 0 8px}} .muted{{color:var(--mut);font-size:13px}}
.stats{{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}} .stat{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 16px}}
.stat b{{font-size:22px;display:block}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:10px;margin:8px 0;padding:0 14px}} .card summary{{cursor:pointer;padding:10px 0;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}}
.score{{font-weight:700;min-width:28px}} .tag{{color:var(--mut);font-size:12px;border:1px solid var(--line);border-radius:99px;padding:0 8px}}
.state{{font-size:12px;margin-left:auto;font-weight:600}} .state.ok{{color:var(--ok)}} .state.ready{{color:var(--ready)}} .state.skip{{color:var(--skip)}}
code{{background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:0 5px;font-size:12px}}
.body{{padding:4px 0 12px}} .btn{{background:var(--ready);color:#fff;text-decoration:none;border-radius:6px;padding:4px 10px;font-size:13px;margin-right:8px}}
a{{color:var(--ready)}} ul{{margin:4px 0 8px 18px;padding:0}} .rules{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:4px 16px}}
</style></head><body>
<h1>Which resume went where</h1>
<div class="muted">Generated {datetime.now():%Y-%m-%d %H:%M} by <code>scripts/resume_report.py</code>. Version ids (<code>r-xxxxxx</code>) are content hashes: the same id means the exact same resume.</div>
<div class="stats"><div class="stat"><b>{len(rows)}</b>jobs analyzed</div><div class="stat"><b>{len(tailored)}</b>resumes tailored</div>
<div class="stat"><b>{len(versions)}</b>distinct resume versions</div><div class="stat"><b>{sum(1 for r in rows if r['submitted'])}</b>submitted</div>
<div class="stat"><b>{len(skipped)}</b>not tailored</div></div>
<div class="rules"><h2 style="margin-top:8px">How a job gets skipped</h2>
<p class="muted">Lean inclusive: you approve every application, so only real blockers stop a job. Everything else is shown to you as a flag.</p>
<ol><li><b>Code filter (before any AI):</b> QA/test/SDET, senior/staff/lead titles, intern, non-software or hardware, active-clearance, non-engineering titles, and regions outside the user's targets.</li>
<li><b>Cheap screen:</b> under {CONFIG['daily']['screen_threshold']} means little overlap with what you've built. Missing tools or languages alone never drop a job here.</li>
<li><b>Fit bands:</b> 75+ apply and {MIN_FIT}–74 stretch both get a resume; {CONFIG['daily']['long_shot_fit']}–{MIN_FIT - 1} is a long shot (tailored if you ask); below that is skipped.</li>
<li><b>Hard skips only:</b> 5+ years required, active clearance, closed posting, region rule, excluded role, not software.</li>
<li><b>Flags, not skips:</b> class-year windows, relocation, duplicates, school or GPA screens, clearance eligibility.</li>
<li><b>Daily cap:</b> at most <b>{MAX_TAILORED}</b> new resumes a day; the rest wait for the next run.</li>
<li><b>Always your call:</b> nothing is submitted until you approve it by number in chat.</li></ol></div>
<h2>Resumes made ({len(tailored)})</h2>{''.join(card(r) for r in tailored) or '<p class="muted">None yet.</p>'}
<h2>Analyzed but not tailored ({len(skipped)})</h2>{''.join(card(r) for r in skipped)}
</body></html>"""


def main() -> None:
    rows = collect()
    if "--sheet-ids" in sys.argv:
        ids = json.loads(Path(sys.argv[sys.argv.index("--sheet-ids") + 1]).read_text(encoding="utf-8-sig"))
        # Columns U..Z of the Applications tab: Resume version, Resume file, Strongest bullets, Gaps found,
        # Keywords covered, Resume changes vs master. Analysis columns are filled for every analyzed job;
        # the version/file/changes columns only when a resume was tailored.
        by_id = {r["job_id"]: r for r in rows}
        out = []
        for i in ids:
            r = by_id.get(i)
            if not r:
                out.append([""] * 6)
                continue
            out.append([
                r["version"],
                f"applications/{r['pdf']}" if r["pdf"] else "",
                clip(", ".join(r["bullet_labels"]), 140),
                clip("; ".join(r["gaps"][:4]), 160),
                clip(", ".join(r["covered"][:8]), 120),
                clip(r["diff_short"], 120),
            ])
        print(json.dumps(out, ensure_ascii=False))
        return
    target = APPS / "INDEX.html"
    target.write_text(build_html(rows), encoding="utf-8")
    print(f"wrote {target}  ({len(rows)} analyzed, {sum(r['tailored'] for r in rows)} tailored, "
          f"{len({r['version'] for r in rows if r['version']})} distinct versions)")
    if "--open" in sys.argv:
        webbrowser.open(target.as_uri())


if __name__ == "__main__":
    main()
