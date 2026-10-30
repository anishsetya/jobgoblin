"""Print Companies-tab rows (columns A-N) from companies/targets.yaml as compact JSON.

  seed     every target + every not-on-ATS candidate (used once to fill the tab)
  numbers  only [tracks, open roles, relevant roles, last checked] (cols H-J + M) per target, in sheet order
           (used by the weekly refresh)

Usage: .venv/Scripts/python.exe scripts/companies_rows.py seed|numbers [--names "A,B"]
"""
import json
import sys
from datetime import date
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
URLS = {"greenhouse": "https://job-boards.greenhouse.io/{s}", "ashby": "https://jobs.ashbyhq.com/{s}",
        "lever": "https://jobs.lever.co/{s}"}
today = date.today().isoformat()
data = yaml.safe_load((ROOT / "companies" / "targets.yaml").read_text(encoding="utf-8"))

mode = sys.argv[1] if len(sys.argv) > 1 else "seed"
names = None
if "--names" in sys.argv:
    names = [n.strip() for n in sys.argv[sys.argv.index("--names") + 1].split(",")]

rows = []
if mode == "seed":
    for c in data["companies"]:
        rows.append([c["name"], c["tier"], "Target", c["ats"], c["slug"], URLS[c["ats"]].format(s=c["slug"]),
                     c["focus"], ", ".join(c.get("tracks", [])), c["open_roles"], c["relevant_roles"],
                     "seed", today, today, ""])
    for c in data.get("not_on_ats", []):
        rows.append([c["name"], c["tier"], "Check manually", "careers site", "", "", c["focus"], "", "", "",
                     "seed", today, today, "Not on Greenhouse/Ashby/Lever; find the careers page and check by hand"])
else:
    for c in data["companies"]:
        if names is None or c["name"] in names:
            rows.append([c["name"], ", ".join(c.get("tracks", [])), c["open_roles"], c["relevant_roles"], today])
print(json.dumps(rows, ensure_ascii=False, separators=(",", ":")))
