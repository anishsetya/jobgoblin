"""Print the /apply-batch table (markdown) for every tailored, unsubmitted application, and save the numbering to
state/batch.json so "submit 3" always maps to the same job. Long shots are listed separately.

Usage: .venv/Scripts/python.exe scripts/batch_table.py
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import resume_report as rr  # noqa: E402

TAGS = [  # (regex over flags+notes, short tag)
    (r"class-year|graduat|grad window|2027 start|spring 2027|dec 2026", "class year"),
    (r"duplicate", "duplicate"),
    (r"18-month", "18-mo exp cap"),
    (r"clearance", "clearance elig."),
    (r"master'?s", "master's req"),
    (r"\b[345]\+ ?y|3-5 y|4-6 y|3\+ years", "years ask"),
    (r"senior|staff|mid-level", "senior-ish scope"),
    (r"timezone|gmt", "timezone"),
    (r"cannot be hired in|not eligible in", "state limits"),
    (r"github|public project|repo", "needs GitHub"),
    (r"relocat|onsite|on-site|in-person|hybrid|in office", "onsite/relocate"),
    (r"reside|residence|us-resident", "US residence"),
    (r"stale|#li-dni|mismatch|confirm the req", "check posting"),
    (r"closes", "closing soon"),
]


def tags_for(fit: dict) -> list[str]:
    if "flags" not in fit:
        return ["flags not checked (pre-rubric)"]
    text = " ".join(fit.get("flags", [])).lower()  # flags only: notes mention risks in passing
    out = [t for rx, t in TAGS if re.search(rx, text)]
    return out[:4]


def main() -> None:
    rows = [r for r in rr.collect() if r["tailored"] and not r["submitted"]]
    fits = {r["folder"]: rr.read_json(rr.APPS / r["folder"] / "fit.json") for r in rows}
    rows.sort(key=lambda r: (-(r["score"] or 0), {"US": 0, "REMOTE": 1, "IN": 2}.get(r["region"], 3)))
    numbering = {}
    print("| # | Company | Role | Region | Fit | Track | Resume | Flags |")
    print("|---|---|---|---|---|---|---|---|")
    for i, r in enumerate(rows, 1):
        numbering[i] = {"folder": r["folder"], "job_id": r["job_id"], "version": r["version"]}
        role = rr.clip(r["title"], 48)
        flags = ", ".join(tags_for(fits[r["folder"]])) or "none"
        print(f"| {i} | {r['company']} | [{role}](applications/{r['pdf']}) | {r['region']} | {r['score']} | "
              f"{r['track']} | {r['version']} | {flags} |")
    longs = [r for r in rr.collect() if rr.read_json(rr.APPS / r["folder"] / "fit.json").get("apply_recommendation") == "long-shot"]
    if longs:
        print("\nLONG SHOTS")
        for j, r in enumerate(sorted(longs, key=lambda r: -(r["score"] or 0)), 1):
            note = rr.clip(rr.read_json(rr.APPS / r["folder"] / "fit.json").get("notes", ""), 140)
            print(f"L{j}. {r['company']}: {rr.clip(r['title'], 50)} ({r['score']}): {note}")
            numbering[f"L{j}"] = {"folder": r["folder"], "job_id": r["job_id"]}
    (rr.ROOT / "state").mkdir(exist_ok=True)
    (rr.ROOT / "state" / "batch.json").write_text(
        json.dumps({"created": datetime.now().isoformat(timespec="seconds"), "items": numbering}, indent=1),
        encoding="utf-8")


if __name__ == "__main__":
    main()
