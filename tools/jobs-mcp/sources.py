"""Non-ATS job sources: HN "Who is hiring?", YC company jobs, RemoteOK, We Work Remotely.

All are public, keyless endpoints used at personal volume (a few requests per run). Wellfound and
Work at a Startup are deliberately NOT here — their terms forbid scraping / they require login, so they
are browsed in the user's own Chrome via the /browse-boards skill instead.

Descriptions are cached in state/cache/web_jobs.json (git-ignored) so get_job can return them later.
"""
from __future__ import annotations

import asyncio
import html
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import httpx

import jobs_core as core

UA = {"User-Agent": "jobs-mcp/0.1 (personal job search)"}
CACHE = core.STATE_DIR / "cache" / "web_jobs.json"

HN_SEARCH = "https://hn.algolia.com/api/v1/search_by_date"
HN_ITEM = "https://hn.algolia.com/api/v1/items/{id}"
YC_ROLES = ["software-engineer", "machine-learning-engineer", "devops-engineer", "backend-engineer",
            "full-stack-engineer"]
YC_ROLE_URL = "https://www.ycombinator.com/jobs/role/{role}"
REMOTEOK_API = "https://remoteok.com/api"
WWR_FEEDS = [
    "https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss",
    "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss",
    "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss",
]

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
OBFUSCATED = [(re.compile(r"\s*[\[(]\s*at\s*[\])]\s*", re.I), "@"),
              (re.compile(r"\s*[\[(]\s*dot\s*[\])]\s*", re.I), ".")]
SENIOR_YEARS = re.compile(r"\b([4-9]|1\d)\+?\s*(years|yrs)", re.I)


# ---------------------------------------------------------------- helpers


def _emails(text: str) -> list[str]:
    for rx, rep in OBFUSCATED:
        text = rx.sub(rep, text)
    found = {e.rstrip(".").lower() for e in EMAIL.findall(text)}
    return sorted(e for e in found if not e.endswith((".png", ".jpg", ".gif")))


def _job(source: str, native: str, company: str, title: str, location: str, url: str, posted: str | None,
         description: str, remote_hint: bool = False, emails: list[str] | None = None,
         meta: dict | None = None, title_for_class: str | None = None) -> core.Job:
    track, seniority_ok, excluded = core.classify_title(title_for_class or title)
    remote = remote_hint or "remote" in location.lower()
    return core.Job(
        id=f"{source}:{source}:{native}", company=company.strip() or "Unknown", title=title.strip(),
        location=location.strip(), region=core.classify_region(location, remote), remote=remote, url=url,
        ats=source, posted_at=posted, track=track, seniority_ok=seniority_ok, excluded_reason=excluded,
        tier=None, description=description, contact_emails=emails or [], meta=meta or {},
    )


def save_cache(jobs: list[core.Job]) -> None:
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    for j in jobs:
        cache[j.id] = {**j.summary(), "description": j.description}
    CACHE.write_text(json.dumps(cache), encoding="utf-8")


def from_cache(job_id: str) -> dict | None:
    if not CACHE.exists():
        return None
    return json.loads(CACHE.read_text(encoding="utf-8")).get(job_id)


# ---------------------------------------------------------------- HN "Who is hiring?"


async def hn_whos_hiring(client: httpx.AsyncClient) -> list[core.Job]:
    r = await client.get(HN_SEARCH, params={"tags": "story,author_whoishiring", "hitsPerPage": 5})
    story = next(h for h in r.json()["hits"] if "who is hiring" in h["title"].lower())
    thread = (await client.get(HN_ITEM.format(id=story["objectID"]))).json()
    jobs = []
    for c in thread.get("children", []):
        raw = c.get("text") or ""
        if not raw:
            continue
        text = core.html_to_text(raw)
        header = text.split("\n", 1)[0]
        parts = [p.strip() for p in re.split(r"\s*\|\s*|\s+[—–]\s+", header) if p.strip()]
        company = parts[0][:80] if parts else "Unknown"
        location = " / ".join(p for p in parts[1:] if core.classify_region(p, False) in ("US", "IN")
                              or "remote" in p.lower())
        role_part = next((p for p in parts[1:] if core.ENGINEERING.search(p)), header)
        job = _job("hn", str(c["id"]), company, role_part[:120], location or header[:120],
                   f"https://news.ycombinator.com/item?id={c['id']}", c.get("created_at"), text,
                   remote_hint="remote" in header.lower(), emails=_emails(text),
                   meta={"thread": story["title"], "header": header[:300]},
                   # HN headers often list several roles incl. "Senior"; judge on software-ness only.
                   title_for_class=re.sub(r"\b(senior|sr\.?|staff|lead|principal)\b", "", role_part, flags=re.I))
        jobs.append(job)
    return jobs


# ---------------------------------------------------------------- YC company jobs (ycombinator.com/jobs)


def _yc_ok(p: dict) -> str | None:
    exp = (p.get("minExperience") or "").lower()
    if SENIOR_YEARS.search(exp):
        return "too senior"
    return None


async def yc_jobs(client: httpx.AsyncClient) -> list[core.Job]:
    seen, jobs = set(), []
    for role in YC_ROLES:
        r = await client.get(YC_ROLE_URL.format(role=role))
        if r.status_code != 200:
            continue
        m = re.search(r'data-page="([^"]+)"', r.text)
        if not m:
            continue
        for p in json.loads(html.unescape(m.group(1)))["props"].get("jobPostings", []):
            if p["id"] in seen:
                continue
            seen.add(p["id"])
            meta = {k: p.get(k) for k in ("salaryRange", "equityRange", "minExperience", "visa",
                                          "companyBatchName", "companyOneLiner", "hiringManager", "applyUrl")}
            job = _job("yc", str(p["id"]), p.get("companyName", ""), p.get("title", ""), p.get("location") or "",
                       "https://www.ycombinator.com" + p.get("url", ""), p.get("createdAt"),
                       f"{p.get('companyOneLiner', '')}\n\nRole type: {p.get('roleSpecificType')}\n"
                       f"Experience: {p.get('minExperience')}\nVisa: {p.get('visa')}\nSalary: {p.get('salaryRange')}",
                       meta=meta)
            if not job.excluded_reason and (reason := _yc_ok(p)):
                job.excluded_reason, job.seniority_ok = reason, False
            jobs.append(job)
    return jobs


# ---------------------------------------------------------------- RemoteOK (public API; attribution = link back)


async def remoteok(client: httpx.AsyncClient) -> list[core.Job]:
    data = (await client.get(REMOTEOK_API)).json()
    jobs = []
    for p in data[1:]:  # first element is the legal notice
        sal = f"${p.get('salary_min')}-{p.get('salary_max')}" if p.get("salary_min") else None
        jobs.append(_job("remoteok", str(p.get("id")), p.get("company", ""), p.get("position", ""),
                         p.get("location") or "Remote", p.get("url", ""), p.get("date"),
                         core.html_to_text(p.get("description", "")), remote_hint=True,
                         meta={"tags": p.get("tags"), "salary": sal, "apply_url": p.get("apply_url")}))
    return jobs


# ---------------------------------------------------------------- We Work Remotely (RSS)


async def wwr(client: httpx.AsyncClient) -> list[core.Job]:
    jobs = []
    for feed in WWR_FEEDS:
        r = await client.get(feed)
        if r.status_code != 200:
            continue
        for item in ET.fromstring(r.content).iter("item"):
            title = item.findtext("title") or ""
            company, _, role = title.partition(":")
            link = item.findtext("link") or ""
            region = item.findtext("region") or "Remote"
            jobs.append(_job("wwr", link.rstrip("/").rsplit("/", 1)[-1], company, role or title, region, link,
                             item.findtext("pubDate"), core.html_to_text(item.findtext("description") or ""),
                             remote_hint=True))
    return jobs


# ---------------------------------------------------------------- entry point

SOURCES = {"hn": hn_whos_hiring, "yc": yc_jobs, "remoteok": remoteok, "wwr": wwr}


async def fetch_web(names: list[str]) -> tuple[list[core.Job], list[str]]:
    async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers=UA) as client:
        results = await asyncio.gather(*(SOURCES[n](client) for n in names if n in SOURCES),
                                       return_exceptions=True)
    jobs, errors = [], []
    for name, res in zip([n for n in names if n in SOURCES], results):
        if isinstance(res, Exception):
            errors.append(f"{name}: {type(res).__name__}: {res}")
        else:
            jobs.extend(res)
    save_cache(jobs)
    return jobs, errors
