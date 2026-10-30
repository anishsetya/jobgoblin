"""jobs-mcp — MCP server for the Jobgoblin pipeline.

Sources:
  ats       Greenhouse / Lever / Ashby boards of companies in companies/targets.yaml
  hn        latest HN "Ask HN: Who is hiring?" thread (many posts include an email to contact)
  yc        ycombinator.com/jobs (YC startups; includes visa + min-experience + salary)
  remoteok  RemoteOK public API
  wwr       We Work Remotely RSS (back-end, full-stack, devops)

Run (stdio): .venv/Scripts/python.exe tools/jobs-mcp/server.py
"""
from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone

import httpx
from mcp.server import MCPServer

import jobs_core as core
import sources as web

DEFAULT_REGIONS = ["US", "REMOTE", "IN"]
ALL_SOURCES = ["ats", "hn", "yc", "remoteok", "wwr"]

server = MCPServer(
    name="jobs",
    log_level="WARNING",
    instructions=(
        "Job discovery over public ATS boards (companies/targets.yaml) plus HN Who's Hiring, YC jobs, RemoteOK "
        "and We Work Remotely. Results are pre-filtered: QA/test, senior, intern and non-engineering titles are "
        "excluded by default. Regions: US, REMOTE (unspecified country), IN. Tracks: ai, backend, platform, fde. "
        "Job ids look like '<source>:<slug>:<id>'. Wellfound / Work at a Startup are not covered (browse them in Chrome)."
    ),
)


def _pick(companies: list[str] | None) -> list[dict]:
    targets = core.load_targets()
    if not companies:
        return targets
    wanted = {c.lower() for c in companies}
    return [t for t in targets if t["name"].lower() in wanted or t["slug"].lower() in wanted]


async def _gather(sources: list[str] | None, companies: list[str] | None) -> tuple[list[core.Job], list[str]]:
    """Fetch from the requested sources. Passing `companies` restricts to ATS boards of those companies."""
    sources = ["ats"] if companies else (sources or ALL_SOURCES)
    tasks = []
    if "ats" in sources:
        tasks.append(core.fetch_all(_pick(companies)))
    web_names = [s for s in sources if s != "ats"]
    if web_names:
        tasks.append(web.fetch_web(web_names))
    jobs, errors = [], []
    for js, errs in await asyncio.gather(*tasks):
        jobs += js
        errors += errs
    return jobs, errors


@server.tool()
def list_companies(tier: int | None = None) -> list[dict]:
    """List target companies (name, ats, slug, tier, region focus). Optionally filter by tier (1 = dream)."""
    return [c for c in core.load_targets() if tier is None or c.get("tier") == tier]


@server.tool()
async def search_jobs(
    query: str | None = None,
    companies: list[str] | None = None,
    sources: list[str] | None = None,
    regions: list[str] | None = None,
    tracks: list[str] | None = None,
    include_excluded: bool = False,
    max_results: int = 100,
) -> dict:
    """Search open roles.

    query: case-insensitive regex matched against title + description (Greenhouse boards: title only).
    companies: names or slugs of target companies (restricts to their ATS boards).
    sources: subset of ats, hn, yc, remoteok, wwr (default all).
    regions: subset of US, REMOTE, IN, OTHER (default US, REMOTE, IN). tracks: subset of ai, backend, platform, fde.
    include_excluded: also return QA/senior/intern rows (for debugging).
    Returns summaries (no descriptions) sorted US-first, newest first, plus per-source errors.
    """
    jobs, errors = await _gather(sources, companies)
    regions = regions or DEFAULT_REGIONS
    rx = re.compile(query, re.IGNORECASE) if query else None
    hits = [
        j for j in jobs
        if core.passes(j, regions, tracks, include_excluded)
        and (rx is None or rx.search(j.title) or rx.search(j.description))
    ]
    hits.sort(key=lambda j: (j.posted_at or ""), reverse=True)
    hits.sort(key=core.region_rank)
    return {"count": len(hits), "jobs": [j.summary() for j in hits[:max_results]], "errors": errors}


@server.tool()
async def new_since_last_run(
    regions: list[str] | None = None,
    tracks: list[str] | None = None,
    companies: list[str] | None = None,
    sources: list[str] | None = None,
    mark_seen: bool = True,
) -> dict:
    """Return filtered roles not returned by any previous call, then (by default) mark them seen in
    state/seen.json (committed to git, so every session shares it).

    This is the daily-hunt entry point. sources defaults to all (ats, hn, yc, remoteok, wwr).
    Use mark_seen=False for a dry run.
    """
    jobs, errors = await _gather(sources, companies)
    seen = core.load_seen()
    regions = regions or DEFAULT_REGIONS
    fresh = [j for j in jobs if j.id not in seen and core.passes(j, regions, tracks)]
    fresh.sort(key=core.region_rank)
    if mark_seen:
        now = datetime.now(timezone.utc).isoformat()
        seen.update({j.id: now for j in fresh})
        core.save_seen(seen)
    return {"count": len(fresh), "jobs": [j.summary() for j in fresh], "errors": errors}


@server.tool()
async def cold_email_leads(regions: list[str] | None = None, tracks: list[str] | None = None) -> dict:
    """Roles whose posting publicly invites direct contact: HN Who's Hiring posts that include an email,
    and YC jobs that name a hiring manager. Use for /cold-outreach. Only use emails exactly as published here;
    never guess or permute addresses.
    """
    jobs, errors = await web.fetch_web(["hn", "yc"])
    regions = regions or DEFAULT_REGIONS
    leads = [
        j.summary() for j in jobs
        if core.passes(j, regions, tracks) and (j.contact_emails or (j.meta or {}).get("hiringManager"))
    ]
    leads.sort(key=lambda d: {"US": 0, "REMOTE": 1, "IN": 2}.get(d["region"], 3))
    return {"count": len(leads), "leads": leads, "errors": errors}


@server.tool()
async def discover_companies(
    sources: list[str] | None = None,
    regions: list[str] | None = None,
    tracks: list[str] | None = None,
    max_results: int = 40,
) -> dict:
    """Companies NOT yet in companies/targets.yaml that currently have at least one fitting role on HN Who's
    Hiring, YC jobs, RemoteOK or We Work Remotely. Pure code, no LLM cost. Use it to fill the Sheet's
    Companies tab with 'Suggested' rows. sources defaults to hn, yc, remoteok, wwr.
    Each row: company, roles (count), sample_titles, regions, tracks, sources, url, has_contact_email, meta hints.
    """
    names = [s for s in (sources or ["hn", "yc", "remoteok", "wwr"]) if s in web.SOURCES]
    jobs, errors = await web.fetch_web(names)
    regions = regions or DEFAULT_REGIONS
    known = {core.norm_company(t["name"]) for t in core.load_targets()}
    known |= {core.norm_company(n) for n in core.load_not_on_ats()}
    senior = re.compile(r"\b(senior|sr\.?|staff|principal|lead|manager|director)\b", re.IGNORECASE)
    open_level = re.compile(r"new grad|junior|entry|early career|all levels|multiple|various|several|founding",
                            re.IGNORECASE)
    groups: dict[str, list[core.Job]] = {}
    for j in jobs:
        key = core.norm_company(j.company)
        if not key or key in known or not core.passes(j, regions, tracks):
            continue
        # HN posts bundle roles, so seniority was ignored when classifying them; don't suggest a company
        # whose only visible role is senior-only.
        if senior.search(j.title) and not open_level.search(j.title):
            continue
        groups.setdefault(key, []).append(j)
    rows = []
    for js in groups.values():
        meta = next((j.meta for j in js if j.meta), {})
        rows.append({
            "company": core.clean_company(js[0].company),
            "roles": len(js),
            "sample_titles": [j.title[:80] for j in js[:3]],
            "regions": sorted({j.region for j in js}),
            "tracks": sorted({j.track for j in js if j.track}),
            "sources": sorted({j.ats for j in js}),
            "url": js[0].url,
            "has_contact_email": any(j.contact_emails for j in js),
            "hints": {k: meta.get(k) for k in ("salaryRange", "visa", "minExperience", "companyBatchName",
                                               "companyOneLiner") if meta.get(k)},
        })
    def _rank(r: dict) -> tuple:
        # US first; then more roles, AI/FDE tracks, YC (shows visa + new-grad hints) and a published contact email.
        bonus = (2 * r["roles"] + (2 if {"ai", "fde"} & set(r["tracks"]) else 0)
                 + (2 if "yc" in r["sources"] else 0) + (1 if r["has_contact_email"] else 0))
        return (0 if "US" in r["regions"] else 1, -bonus)

    rows.sort(key=_rank)
    return {"count": len(rows), "companies": rows[:max_results], "errors": errors}


@server.tool()
async def get_job(job_id: str, max_chars: int | None = None) -> dict:
    """Full posting (summary + plain-text description) for an id from search_jobs / new_since_last_run /
    cold_email_leads, formatted '<source>:<slug>:<native id>'.
    max_chars truncates the description (cheap screening reads use ~2000)."""
    out = await _get_job(job_id)
    if max_chars and isinstance(out.get("description"), str) and len(out["description"]) > max_chars:
        out["description"] = out["description"][:max_chars] + " …[truncated]"
    return out


async def _get_job(job_id: str) -> dict:
    ats, slug, native = job_id.split(":", 2)
    if ats in web.SOURCES:
        cached = web.from_cache(job_id)
        if cached is None:
            await web.fetch_web([ats])
            cached = web.from_cache(job_id)
        return dict(cached) if cached else {"error": f"{job_id} not found — posting may be gone"}
    target = next((t for t in core.load_targets() if t["ats"] == ats and t["slug"] == slug),
                  {"name": slug, "ats": ats, "slug": slug})
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        if ats == "greenhouse":
            r = await client.get(core.GREENHOUSE_JOB_URL.format(slug=slug, id=native))
            if r.status_code == 404:
                return {"error": f"{job_id} not found — posting may be closed"}
            r.raise_for_status()
            job = core._normalize(ats, slug, target["name"], target.get("tier"), r.json())
            return {**job.summary(), "description": job.description}
        jobs, err = await core.fetch_company(client, target)
    if err:
        return {"error": err}
    job = next((j for j in jobs if j.id == job_id), None)
    if job is None:
        return {"error": f"{job_id} not found — posting may be closed"}
    return {**job.summary(), "description": job.description}


@server.tool()
async def list_jobs(company: str, include_excluded: bool = False) -> dict:
    """All open roles at one target company (name or slug), filtered unless include_excluded=True. Any region."""
    targets = _pick([company])
    if not targets:
        return {"error": f"{company} is not in companies/targets.yaml"}
    jobs, errors = await core.fetch_all(targets)
    regions = ["US", "REMOTE", "IN", "OTHER"]
    keep = [j.summary() for j in jobs if core.passes(j, regions, None, include_excluded)]
    return {"count": len(keep), "jobs": keep, "errors": errors}


if __name__ == "__main__":
    server.run("stdio")
