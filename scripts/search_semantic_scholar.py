#!/usr/bin/env python3
"""Search Semantic Scholar without an API key and emit structured results."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request


API_URL = "https://api.semanticscholar.org/graph/v1/paper/search"
FIELDS = "title,authors,year,venue,citationCount,abstract,url,externalIds,openAccessPdf"


def search(query: str, limit: int, year: str | None) -> dict:
    params = {"query": query, "limit": str(limit), "fields": FIELDS}
    if year:
        params["year"] = year
    request = urllib.request.Request(
        f"{API_URL}?{urllib.parse.urlencode(params)}",
        headers={"User-Agent": "openclaw-research-agent/1.0"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", help="paper search query")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--year", help="single year or range, for example 2024-2026")
    parser.add_argument("--json", action="store_true", help="print raw JSON")
    args = parser.parse_args()

    limit = max(1, min(args.limit, 100))
    try:
        payload = search(args.query, limit, args.year)
    except urllib.error.HTTPError as exc:
        print(f"Semantic Scholar returned HTTP {exc.code}: {exc.reason}", file=sys.stderr)
        return 2
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"Semantic Scholar request failed: {exc}", file=sys.stderr)
        return 3

    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    for index, paper in enumerate(payload.get("data", []), start=1):
        authors = ", ".join(a.get("name", "") for a in paper.get("authors", [])[:5])
        external_ids = paper.get("externalIds") or {}
        arxiv_id = external_ids.get("ArXiv")
        print(f"{index}. {paper.get('title', 'Untitled')} ({paper.get('year', 'n.d.')})")
        print(f"   Authors: {authors or 'Unknown'}")
        print(f"   Venue: {paper.get('venue') or 'Unknown'} | Citations: {paper.get('citationCount', 0)}")
        print(f"   URL: {paper.get('url') or ''}")
        if arxiv_id:
            print(f"   arXiv: https://arxiv.org/abs/{arxiv_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
