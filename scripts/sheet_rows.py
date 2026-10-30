"""Build Google Sheet (Applications tab) updates from the application folders. Pure code, no LLM cost.

Inputs
  --sheet-ids <file>    JSON array of Applications!A2:A values, in row order (row 2 first)
  --drive <file>        optional JSON object {drive file name: viewUrl} for the resume folder in Drive

Output (stdout, JSON)
  existing      rows for K2:Z<n>, aligned with --sheet-ids. null = leave that cell alone.
                K Fit, L Status, M-S untouched, T Notes, U-Z resume/analysis columns.
                Fit, Status and Notes are only written for jobs re-scored under the current rubric
                (fit.json has "rescored"), so statuses that moved on (Applied, OA, ...) are never overwritten.
  existing_aa   =HYPERLINK formulas for AA2:AA<n> ("" where there is no resume)
  append        full A:Z rows for analyzed jobs that have no Sheet row yet
  append_aa     AA formulas for those appended rows

Usage: .venv/Scripts/python.exe scripts/sheet_rows.py --sheet-ids ids.json [--drive links.json]
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import resume_report as rr  # noqa: E402

DUPLICATE_OF = {  # exact-duplicate postings that reuse a sibling's resume
    "langchain_deployed-engineer-early-career-nyc": "LangChain SF",
    "harvey_software-engineer-new-grad-2027-sf": "Harvey NYC",
    "rubrik_software-engineer-saas-o365": "Rubrik Cloud: Azure",
}


def arg(name: str) -> str | None:
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else None


def status_for(r: dict, fit: dict) -> str:
    rec = fit.get("apply_recommendation", "")
    if r["submitted"]:
        return "Applied"
    if r["tailored"] and rec in ("apply", "stretch"):
        return "Awaiting approval"
    if rec == "long-shot":
        return "Long shot"
    return "Skipped (hard skip)" if (fit.get("score") or 0) == 0 else "Skipped (low fit)"


def notes_for(r: dict, fit: dict) -> str:
    slug = r["folder"].split("_", 1)[1]
    parts = []
    if "score_v1" in fit:
        parts.append(f"Rescored {fit['score_v1']}→{fit.get('score')} on {fit.get('rescored')} (less strict rubric).")
    if slug in DUPLICATE_OF:
        parts.append(f"Duplicate of {DUPLICATE_OF[slug]}: same JD and resume, apply to one location.")
    if fit.get("notes"):
        parts.append(fit["notes"].strip())
    if fit.get("flags"):
        parts.append("Flags: " + "; ".join(fit["flags"]))
    return rr.clip(" ".join(parts), 320)


def location_from_jd(folder: Path) -> str:
    jd = folder / "jd.md"
    if jd.exists():
        m = re.search(r"^- Location:\s*(.+)$", jd.read_text(encoding="utf-8-sig"), re.M)
        if m:
            return m.group(1).strip()[:120]
    return ""


def analysis_cols(r: dict) -> list:
    return [
        r["version"],
        f"applications/{r['pdf']}" if r["pdf"] else "",
        rr.clip(", ".join(r["bullet_labels"]), 140),
        rr.clip("; ".join(r["gaps"][:4]), 160),
        rr.clip(", ".join(r["covered"][:8]), 120),
        rr.clip(r["diff_short"], 120),
    ]


def link_formula(r: dict, drive: dict) -> str:
    if not r["tailored"]:
        return ""
    name = f"{r['folder'].split('_', 1)[1]}__{r['version']}.pdf"
    url = drive.get(name, "")
    return f'=HYPERLINK("{url.split("?")[0]}","Open {r["version"]}")' if url else ""


def main() -> None:
    ids = json.loads(Path(arg("--sheet-ids")).read_text(encoding="utf-8-sig"))
    drive = json.loads(Path(arg("--drive")).read_text(encoding="utf-8-sig")) if arg("--drive") else {}
    rows = rr.collect()
    by_id = {r["job_id"]: r for r in rows}
    fits = {r["job_id"]: rr.read_json(rr.APPS / r["folder"] / "fit.json") for r in rows}

    existing, existing_aa = [], []
    for i in ids:
        r = by_id.get(i)
        if not r:
            existing.append([None] * 16)
            existing_aa.append([""])
            continue
        fit = fits[i]
        rescored = "rescored" in fit
        existing.append([
            fit.get("score") if rescored else None,       # K Fit
            status_for(r, fit) if rescored else None,      # L Status
            None, None, None, None, None, None, None,      # M-S untouched
            notes_for(r, fit) if rescored else None,       # T Notes
            *analysis_cols(r),                             # U-Z
        ])
        existing_aa.append([link_formula(r, drive)])

    append, append_aa = [], []
    for r in rows:
        if r["job_id"] in ids:
            continue
        fit = fits[r["job_id"]]
        folder = rr.APPS / r["folder"]
        append.append([
            r["job_id"], r["folder"][:10], r["company"], r["title"], r["track"], location_from_jd(folder),
            r["region"], "Yes" if r["region"] == "REMOTE" else "", r["url"], r["job_id"].split(":", 1)[0],
            fit.get("score") or 0, status_for(r, fit), "", "", "", fit.get("rescored", ""), "", "", "",
            notes_for(r, fit), *analysis_cols(r),
        ])
        append_aa.append([link_formula(r, drive)])

    print(json.dumps({"existing": existing, "existing_aa": existing_aa, "append": append, "append_aa": append_aa},
                     ensure_ascii=False))


if __name__ == "__main__":
    main()
