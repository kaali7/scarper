#!/usr/bin/env python3
"""Search Dorker & Public B2B Lead Finder.

Finds LinkedIn company profiles, key decision-makers (CEOs, Founders), and social
channels by querying public search indexers (DuckDuckGo / search HTML) without
requiring a LinkedIn account or login credentials.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus, unquote

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    requests = None
    BeautifulSoup = None

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


@dataclass
class SearchResultItem:
    title: str
    url: str
    snippet: str


@dataclass
class DorkResult:
    query: str
    status: str = "ok"
    results: List[SearchResultItem] = None  # type: ignore
    error: Optional[str] = None


def query_duckduckgo_html(query: str, max_results: int = 8, timeout: int = 10) -> List[SearchResultItem]:
    """Query DuckDuckGo public HTML search interface without API keys."""
    if requests is None or BeautifulSoup is None:
        raise RuntimeError("Missing dependencies: run 'pip install requests beautifulsoup4'")

    url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    resp = requests.post(
        "https://html.duckduckgo.com/html/",
        data={"q": query},
        headers=headers,
        timeout=timeout,
    )
    if resp.status_code != 200:
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    items: List[SearchResultItem] = []

    for result in soup.select(".result"):
        title_tag = result.select_one(".result__title a")
        snippet_tag = result.select_one(".result__snippet")
        if not title_tag:
            continue

        raw_href = title_tag.get("href", "")
        # DuckDuckGo HTML wraps URLs in /l/?uddg=<actual_url>
        clean_href = raw_href
        if "uddg=" in raw_href:
            part = raw_href.split("uddg=")[-1].split("&")[0]
            clean_href = unquote(part)

        title = title_tag.get_text(strip=True)
        snippet = snippet_tag.get_text(strip=True) if snippet_tag else ""

        if clean_href.startswith("http"):
            items.append(SearchResultItem(title=title, url=clean_href, snippet=snippet))
            if len(items) >= max_results:
                break

    return items


def find_linkedin_company(company: str, city: str = "") -> DorkResult:
    """Find company's official LinkedIn page."""
    location_part = f' "{city}"' if city else ""
    query = f'site:linkedin.com/company/ "{company}"{location_part}'
    try:
        results = query_duckduckgo_html(query, max_results=5)
        return DorkResult(query=query, status="ok", results=results)
    except Exception as exc:
        return DorkResult(query=query, status="failed", error=str(exc), results=[])


def find_decision_makers(company: str, roles: Optional[List[str]] = None) -> DorkResult:
    """Find company founders, owners, or executives on LinkedIn."""
    target_roles = roles or ["founder", "owner", "ceo", "director", "managing director"]
    role_clause = " OR ".join(f'"{r}"' for r in target_roles)
    query = f'site:linkedin.com/in/ "{company}" ({role_clause})'
    try:
        results = query_duckduckgo_html(query, max_results=6)
        return DorkResult(query=query, status="ok", results=results)
    except Exception as exc:
        return DorkResult(query=query, status="failed", error=str(exc), results=[])


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Search Dorker & Public B2B Lead Finder",
    )
    parser.add_argument("--company", required=True, help="Target business or company name")
    parser.add_argument("--city", default="", help="Optional city or location filter")
    parser.add_argument(
        "--mode",
        choices=["company", "people", "both"],
        default="both",
        help="Search mode (company = LinkedIn company page, people = decision makers, both = all)",
    )
    parser.add_argument("--json", action="store_true", help="Output results as JSON")

    args = parser.parse_args()

    out: Dict[str, Any] = {"company": args.company}

    if args.mode in ("company", "both"):
        res = find_linkedin_company(args.company, args.city)
        out["linkedin_company"] = asdict(res)

    if args.mode in ("people", "both"):
        res = find_decision_makers(args.company)
        out["decision_makers"] = asdict(res)

    if args.json:
        print(json.dumps(out, indent=2))
    else:
        print(f"\nB2B Dorking Results for: {args.company} {f'({args.city})' if args.city else ''}")
        print("=" * 65)

        if "linkedin_company" in out:
            print("\n🏢 LinkedIn Company Profiles:")
            comp_results = out["linkedin_company"].get("results") or []
            if comp_results:
                for item in comp_results:
                    print(f"  • {item['title']}")
                    print(f"    URL: {item['url']}")
                    if item["snippet"]:
                        print(f"    {item['snippet'][:120]}...")
            else:
                print("  No company profiles indexed.")

        if "decision_makers" in out:
            print("\n👤 Potential Decision Makers (Founders / CEOs):")
            people_results = out["decision_makers"].get("results") or []
            if people_results:
                for item in people_results:
                    print(f"  • {item['title']}")
                    print(f"    URL: {item['url']}")
                    if item["snippet"]:
                        print(f"    {item['snippet'][:120]}...")
            else:
                print("  No public profiles indexed.")
        print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
