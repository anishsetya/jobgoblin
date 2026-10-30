"""Fetch, normalize, classify and filter jobs from public ATS job-board APIs.

Supported boards (all public, no API key):
  greenhouse  https://boards-api.greenhouse.io/v1/boards/{slug}/jobs
  lever       https://api.lever.co/v0/postings/{slug}?mode=json
  ashby       https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true
"""
from __future__ import annotations

import asyncio
import html
import json
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

import httpx
import yaml

ROOT = Path(__file__).resolve().parents[2]
TARGETS = ROOT / "companies" / "targets.yaml"
STATE_DIR = ROOT / "state"  # committed to git so every session (local or cloud) shares it
SEEN_FILE = STATE_DIR / "seen.json"

# Greenhouse list responses omit descriptions (content=true makes big boards multi-MB); get_job fetches
# a single posting with GREENHOUSE_JOB_URL instead.
GREENHOUSE_JOB_URL = "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs/{id}"
ATS_URLS = {
    "greenhouse": "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs",
    "lever": "https://api.lever.co/v0/postings/{slug}?mode=json",
    "ashby": "https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true",
}

# ---------------------------------------------------------------- data model


@dataclass
class Job:
    id: str  # "<ats>:<slug>:<native id>"
    company: str
    title: str
    location: str
    region: str  # US | IN | REMOTE | OTHER
    remote: bool
    url: str
    ats: str
    posted_at: str | None
    track: str | None  # ai | backend | platform | fde | None
    seniority_ok: bool
    excluded_reason: str | None
    tier: int | None = None
    description: str = field(default="", repr=False)
    # Web-board extras: publicly posted contact emails (HN), salary / visa / experience hints (YC, RemoteOK).
    contact_emails: list[str] = field(default_factory=list)
    meta: dict = field(default_factory=dict)

    def summary(self) -> dict:
        d = asdict(self)
        d.pop("description")
        return d


# ---------------------------------------------------------------- html → text


class _Text(HTMLParser):
    BLOCK = {"p", "div", "br", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "tr"}

    def __init__(self) -> None:
        super().__init__()
        self.out: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "li":
            self.out.append("\n- ")
        elif tag in self.BLOCK:
            self.out.append("\n")
        elif tag in {"strong", "b"}:
            self.out.append("**")

    def handle_endtag(self, tag):
        if tag in {"strong", "b"}:
            self.out.append("**")
        elif tag in self.BLOCK:
            self.out.append("\n")

    def handle_data(self, data):
        self.out.append(data)


def html_to_text(raw: str) -> str:
    p = _Text()
    p.feed(html.unescape(raw or ""))  # greenhouse double-escapes content
    text = "".join(p.out)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
    return text.strip()


# ---------------------------------------------------------------- classification

US_STATES = (
    "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY "
    "NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC"
).split()
US_WORDS = [
    "united states", "usa", "u.s.", "us-remote", "remote us", "remote - us", "remote (us", "us remote",
    "americas", "north america", "san francisco", "new york", "nyc", "seattle", "austin", "boston",
    "los angeles", "chicago", "denver", "palo alto", "mountain view", "menlo park", "sunnyvale",
    "san jose", "san mateo", "redwood city", "bay area", "atlanta", "washington", "miami", "portland",
]
IN_WORDS = ["india", "bengaluru", "bangalore", "hyderabad", "pune", "mumbai", "gurgaon", "gurugram",
            "noida", "delhi", "chennai"]

EXCLUDE_TITLE = [
    (r"\b(qa|qe|sdet)\b|quality|test(ing)?\b|tester|verification|validation", "QA/test role"),
    (r"\b(senior|sr\.?|staff|principal|lead|manager|director|head|chief|vp|vice president|architect|"
     r"distinguished|fellow)\b|\biii\b|\biv\b", "too senior"),
    (r"\bintern(ship)?\b|\bco-?op\b", "internship"),
    (r"clearance|\bts/sci\b", "clearance required"),
    (r"\b(recruit|sales|account executive|marketing|designer|counsel|legal|finance|accountant|"
     r"support specialist|customer success|security|threat|data analyst|product manager|tpm|"
     r"program manager)\b",
     "non-engineering"),
    (r"electrical|mechanical|manufactur|aerodynamic|firmware|hardware|industrial|civil|chemical|\brf\b|"
     r"optical|propulsion|structur|thermal|asic|fpga|analog|avionics|flight|actuation|mission|"
     r"production engineer|process engineer|integration engineer", "hardware/non-software"),
]
ENGINEERING = re.compile(r"engineer|developer|\bswe\b|programmer|member of technical staff|\bmts\b",
                         re.IGNORECASE)
# Title must also look like software work, so "Systems Engineer" at a defense company doesn't pass.
SOFTWARE = re.compile(
    r"software|\bswe\b|back[- ]?end|full[- ]?stack|platform|infra|devops|\bsre\b|reliability|cloud|"
    r"\b(ai|ml|llm|genai)\b|machine learning|agent|inference|data engineer|distributed|"
    r"forward[- ]deployed|solutions? engineer|deployment engineer|member of technical staff|\bmts\b|"
    r"applied|developer|\bapi\b|product engineer|research engineer|founding engineer|early career|new grad",
    re.IGNORECASE)
# Strip phrases containing words that would otherwise trip the seniority filter.
NEUTRAL = re.compile(r"member of (the )?technical staff", re.IGNORECASE)

TRACK_RULES = [
    ("fde", r"forward[- ]deployed|solutions? engineer|deployment engineer|customer engineer|"
            r"field engineer|implementation engineer"),
    ("ai", r"\b(ai|ml|llm|genai|gen ai)\b|machine learning|applied (ai|ml|research)|agent|"
           r"inference|research engineer|nlp|model"),
    ("platform", r"platform|infra(structure)?|devops|\bsre\b|reliability|cloud|kubernetes|"
                 r"developer productivity|build|release|ci/cd|systems"),
    ("backend", r"back[- ]?end|distributed|server|api|software engineer|software developer|\bswe\b|"
                r"full[- ]?stack|product engineer|member of technical staff|\bmts\b"),
]


def classify_region(location: str, remote: bool) -> str:
    loc = (location or "").lower()
    if any(w in loc for w in IN_WORDS):
        return "IN"
    if any(w in loc for w in US_WORDS):
        return "US"
    tokens = set(re.findall(r"\b[A-Z]{2}\b", location or ""))
    if tokens & set(US_STATES):
        return "US"
    # REMOTE only when no foreign place is named ("Paris, France" with isRemote=true is OTHER).
    if not loc.strip() or re.fullmatch(r"[\s\-/(),]*(remote|anywhere|global|worldwide|distributed)[\s\-/(),]*", loc):
        return "REMOTE"
    return "OTHER"


def classify_title(title: str) -> tuple[str | None, bool, str | None]:
    """Return (track, seniority_ok, excluded_reason)."""
    if not ENGINEERING.search(title) or not SOFTWARE.search(title):
        return None, True, "non-engineering"
    t = NEUTRAL.sub("mts", title.lower())
    for pattern, reason in EXCLUDE_TITLE:
        if re.search(pattern, t):
            return None, reason != "too senior", reason
    for track, pattern in TRACK_RULES:
        if re.search(pattern, t):
            return track, True, None
    return "backend", True, None


# ---------------------------------------------------------------- fetchers


def _iso(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):  # lever: epoch ms
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc).isoformat()
    return str(value)


def _normalize(ats: str, slug: str, company: str, tier: int | None, raw: dict) -> Job:
    if ats == "greenhouse":
        native, title = raw["id"], raw["title"]
        location = (raw.get("location") or {}).get("name", "")
        remote = "remote" in location.lower()
        url, posted = raw.get("absolute_url", ""), raw.get("first_published") or raw.get("updated_at")
        desc = html_to_text(raw.get("content", ""))
    elif ats == "lever":
        native, title = raw["id"], raw["text"]
        cats = raw.get("categories") or {}
        location = cats.get("location") or ", ".join(cats.get("allLocations") or [])
        remote = raw.get("workplaceType") == "remote" or "remote" in location.lower()
        url, posted = raw.get("hostedUrl", ""), raw.get("createdAt")
        parts = [raw.get("descriptionPlain", "")]
        for lst in raw.get("lists") or []:
            parts.append(f"\n{lst.get('text', '')}\n{html_to_text(lst.get('content', ''))}")
        parts.append(raw.get("additionalPlain", ""))
        desc = "\n".join(p for p in parts if p).strip()
    else:  # ashby
        native, title = raw["id"], raw["title"]
        locs = [raw.get("location") or ""] + [
            (s.get("location") if isinstance(s, dict) else str(s)) for s in raw.get("secondaryLocations") or []
        ]
        location = " / ".join(l for l in locs if l)
        remote = bool(raw.get("isRemote")) or raw.get("workplaceType") == "Remote"
        url, posted = raw.get("jobUrl", ""), raw.get("publishedAt")
        desc = raw.get("descriptionPlain") or html_to_text(raw.get("descriptionHtml", ""))
        comp = (raw.get("compensation") or {}).get("compensationTierSummary")
        if comp:
            desc += f"\n\nCompensation: {comp}"

    track, seniority_ok, excluded = classify_title(title)
    return Job(
        id=f"{ats}:{slug}:{native}",
        company=company,
        title=title.strip(),
        location=location,
        region=classify_region(location, remote),
        remote=remote,
        url=url,
        ats=ats,
        posted_at=_iso(posted),
        track=track,
        seniority_ok=seniority_ok,
        excluded_reason=excluded,
        tier=tier,
        description=desc,
    )


async def fetch_board(client: httpx.AsyncClient, ats: str, slug: str) -> list[dict]:
    r = await client.get(ATS_URLS[ats].format(slug=slug))
    r.raise_for_status()
    data = r.json()
    if ats == "greenhouse":
        return data.get("jobs", [])
    if ats == "ashby":
        return [j for j in data.get("jobs", []) if j.get("isListed", True)]
    return data if isinstance(data, list) else []


def load_targets() -> list[dict]:
    with open(TARGETS, encoding="utf-8") as f:
        return yaml.safe_load(f)["companies"]


def load_not_on_ats() -> list[str]:
    """Names of candidate companies whose careers sites aren't Greenhouse/Ashby/Lever (written by validate_targets)."""
    with open(TARGETS, encoding="utf-8") as f:
        return [c["name"] for c in (yaml.safe_load(f).get("not_on_ats") or [])]


def clean_company(name: str) -> str:
    """'Acme (YC W24, Remote US)' / 'Acme — hiring' -> 'Acme'."""
    name = re.split(r"\s+[—–-]\s+|\s*\(|\s*\[", name or "", maxsplit=1)[0]
    return name.strip(" .,:;|")[:80]


def norm_company(name: str) -> str:
    """Key for matching company names across sources: lowercase alphanumerics, no legal suffixes."""
    s = clean_company(name).lower()
    s = re.sub(r"\b(inc|llc|ltd|corp|co|gmbh|labs|technologies|technology|ai|hq)\b", "", s)
    return re.sub(r"[^a-z0-9]", "", s)


async def fetch_company(client: httpx.AsyncClient, c: dict) -> tuple[list[Job], str | None]:
    try:
        raws = await fetch_board(client, c["ats"], c["slug"])
    except httpx.HTTPStatusError as e:
        return [], f"{c['name']} ({c['ats']}:{c['slug']}): HTTP {e.response.status_code}"
    except Exception as e:  # noqa: BLE001 — one bad board must not sink the run
        return [], f"{c['name']} ({c['ats']}:{c['slug']}): {type(e).__name__}: {e}"
    return [_normalize(c["ats"], c["slug"], c["name"], c.get("tier"), r) for r in raws], None


async def fetch_all(companies: list[dict], concurrency: int = 12) -> tuple[list[Job], list[str]]:
    sem = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient(timeout=30, follow_redirects=True,
                                 headers={"User-Agent": "jobs-mcp/0.1 (personal job search)"}) as client:
        async def one(c):
            async with sem:
                return await fetch_company(client, c)

        results = await asyncio.gather(*(one(c) for c in companies))
    jobs = [j for js, _ in results for j in js]
    errors = [e for _, e in results if e]
    return jobs, errors


# ---------------------------------------------------------------- filtering + state


def passes(job: Job, regions: list[str], tracks: list[str] | None, include_excluded: bool = False) -> bool:
    if not include_excluded and (job.excluded_reason or not job.seniority_ok):
        return False
    if regions and job.region not in regions:
        return False
    if tracks and job.track not in tracks:
        return False
    if job.track == "fde" and job.region == "IN":  # FDE only for US roles
        return False
    return True


def load_seen() -> dict[str, str]:
    if SEEN_FILE.exists():
        return json.loads(SEEN_FILE.read_text(encoding="utf-8"))
    return {}


def save_seen(seen: dict[str, str]) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    SEEN_FILE.write_text(json.dumps(seen, indent=0), encoding="utf-8")


def region_rank(job: Job) -> int:
    return {"US": 0, "REMOTE": 1, "IN": 2}.get(job.region, 3)
