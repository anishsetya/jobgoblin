"""Guardrail checks for a rendered resume PDF.

- must be exactly one page
- must not contain banned terms (profile/rules.yaml -> banned_terms)
- optional: report JD keyword coverage (--keywords "kafka,go,rag")
Exit code 1 on any hard failure.
"""
import argparse
import re
import sys

import yaml
from pathlib import Path
from pypdf import PdfReader

RULES = Path(__file__).resolve().parent.parent / "profile" / "rules.yaml"
BANNED = (yaml.safe_load(RULES.read_text(encoding="utf-8")) or {}).get("banned_terms", []) if RULES.exists() else []


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--keywords", default="")
    args = ap.parse_args()

    reader = PdfReader(args.pdf)
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    ok = True

    pages = len(reader.pages)
    print(f"pages: {pages}")
    if pages != 1:
        print("FAIL: resume must be exactly one page")
        ok = False

    hits = [p for p in BANNED if re.search(p, text, re.IGNORECASE if p[0] != "\\" else 0)]
    if hits:
        print(f"FAIL: banned terms present: {hits}")
        ok = False

    kws = [k.strip() for k in args.keywords.split(",") if k.strip()]
    if kws:
        lower = text.lower()
        found = [k for k in kws if k.lower() in lower]
        missing = [k for k in kws if k.lower() not in lower]
        print(f"keyword coverage: {len(found)}/{len(kws)}")
        if missing:
            print(f"missing: {', '.join(missing)}")

    print("OK" if ok else "CHECKS FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
