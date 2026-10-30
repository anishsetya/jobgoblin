"""Copy every tailored resume PDF into the Google Drive for desktop folder, with a descriptive, immutable name:

    <company>_<role>__<version>.pdf     e.g. ramp_software-engineer-forward-deployed__r-98ff58.pdf

Drive for desktop uploads the files by itself, so this costs no model usage. A re-tailored resume gets a new
version id and therefore a new file, which keeps a record of every version that existed.

Usage: .venv/Scripts/python.exe scripts/sync_drive.py [--folder <application-folder-name>]
Prints a JSON list of {job_id, version, file} for every tailored resume (new or already there).
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
import resume_report as rr  # noqa: E402

CONFIG = yaml.safe_load((rr.ROOT / "config.yaml").read_text(encoding="utf-8"))
DEST = Path(CONFIG["drive"]["local_dir"])


def main() -> None:
    only = sys.argv[sys.argv.index("--folder") + 1] if "--folder" in sys.argv else None
    my_drive = next((p for p in [DEST, *DEST.parents] if p.name == "My Drive"), None)
    if my_drive is None or not my_drive.exists():
        sys.exit(f"Google Drive folder not found for {DEST}. Is Google Drive for desktop running and signed in?")
    DEST.mkdir(parents=True, exist_ok=True)
    out, copied = [], 0
    for r in rr.collect():
        if not r["tailored"] or (only and r["folder"] != only):
            continue
        slug = r["folder"].split("_", 1)[1]  # drop the date prefix
        name = f"{slug}__{r['version']}.pdf"
        src = rr.APPS / r["pdf"]
        dst = DEST / name
        if not dst.exists() or dst.stat().st_size != src.stat().st_size:
            shutil.copyfile(src, dst)
            copied += 1
        out.append({"job_id": r["job_id"], "version": r["version"], "file": name})
    print(json.dumps(out), file=sys.stdout)
    print(f"copied {copied} new file(s); {len(out)} tailored resumes in {DEST}", file=sys.stderr)


if __name__ == "__main__":
    main()
