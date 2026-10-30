"""End-to-end smoke test: spawn server.py over stdio, list tools, and exercise each tool on one board per ATS.

Usage: .venv/Scripts/python.exe tools/jobs-mcp/smoke_test.py
"""
import asyncio
import json
import sys
from pathlib import Path

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

HERE = Path(__file__).resolve().parent
COMPANIES = ["Anthropic", "Perplexity", "Palantir"]  # greenhouse, ashby, lever


def payload(result) -> dict:
    if getattr(result, "structuredContent", None):
        sc = result.structuredContent
        return sc.get("result", sc) if isinstance(sc, dict) else sc
    return json.loads(result.content[0].text)


async def main() -> int:
    params = StdioServerParameters(command=sys.executable, args=[str(HERE / "server.py")], cwd=str(HERE))
    async with stdio_client(params) as (read, write), ClientSession(read, write) as s:
        await s.initialize()
        tools = sorted(t.name for t in (await s.list_tools()).tools)
        print("tools:", tools)
        assert {"search_jobs", "get_job", "list_jobs", "new_since_last_run", "list_companies"} <= set(tools)

        res = payload(await s.call_tool("search_jobs", {"companies": COMPANIES, "max_results": 500}))
        print(f"search_jobs: {res['count']} jobs, errors={res['errors']}")
        assert not res["errors"]
        for ats in ("greenhouse", "ashby", "lever"):
            first = next((j for j in res["jobs"] if j["ats"] == ats), None)
            if first is None:
                print(f"  {ats}: no filtered jobs right now")
                continue
            job = payload(await s.call_tool("get_job", {"job_id": first["id"]}))
            assert "error" not in job, job
            print(f"  {ats}: {job['title']} | {job['location']} | {job['region']}/{job['track']} | "
                  f"desc {len(job['description'])} chars")
            assert len(job["description"]) > 200

        dry = payload(await s.call_tool("new_since_last_run", {"companies": COMPANIES, "mark_seen": False}))
        print(f"new_since_last_run (dry): {dry['count']} (jobs already in state/seen.json are excluded)")
        assert dry["count"] <= res["count"]

        disc = payload(await s.call_tool("discover_companies", {"max_results": 5}))
        print(f"discover_companies: {disc['count']}, errors={disc['errors']}")
        assert not disc["errors"] and disc["count"] > 0

        first = res["jobs"][0]["id"]
        short = payload(await s.call_tool("get_job", {"job_id": first, "max_chars": 300}))
        assert len(short["description"]) <= 320, "get_job max_chars did not truncate"

        leads = payload(await s.call_tool("cold_email_leads", {}))
        print(f"cold_email_leads: {leads['count']}, errors={leads['errors']}")
        assert not leads["errors"]
        if leads["leads"]:
            lead = payload(await s.call_tool("get_job", {"job_id": leads["leads"][0]["id"]}))
            assert "error" not in lead and lead["description"], lead
    print("SMOKE OK")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
