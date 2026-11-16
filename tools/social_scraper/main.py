#!/usr/bin/env python3
"""CLI interface for Social Media Inspector & Lead Finder."""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List

from instagram_public import InstagramProfile, InstagramPublicScraper
from linkedin_dorker import LinkedInCompanyLead, LinkedInDorker


def print_instagram_profile(p: InstagramProfile, as_json: bool = False) -> None:
    if as_json:
        print(json.dumps(asdict(p), indent=2))
        return

    print(f"\n📸 Instagram Profile: @{p.username}")
    print("=" * 60)
    print(f" • Full Name:       {p.full_name or '(None)'}")
    print(f" • URL:             {p.url}")
    print(f" • Followers:       {p.followers or 'Unknown'}")
    print(f" • Following:       {p.following or 'Unknown'}")
    print(f" • Posts:           {p.posts_count or 'Unknown'}")
    print(f" • Verified:        {'Yes' if p.is_verified else 'No'}")
    if p.bio:
        print(f" • Bio:             {p.bio}")
    if p.emails:
        print(f" • Public Emails:   {', '.join(p.emails)}")
    if p.phones:
        print(f" • Public Phones:   {', '.join(p.phones)}")
    if p.error:
        print(f" • Error:           {p.error}")
    print()


def print_linkedin_lead(l: LinkedInCompanyLead, as_json: bool = False) -> None:
    if as_json:
        print(json.dumps(asdict(l), indent=2))
        return

    print(f"\n💼 LinkedIn Company Lead: {l.company_name}")
    print("=" * 60)
    print(f" • URL:             {l.linkedin_url or '(Not found)'}")
    print(f" • Headline:        {l.headline or '(None)'}")
    if l.employee_count_hint:
        print(f" • Employees:       {l.employee_count_hint}")
    if l.location_hint:
        print(f" • Location:        {l.location_hint}")
    if l.industry_hint:
        print(f" • Industry:        {l.industry_hint}")
    if l.snippet:
        print(f" • Snippet:         {l.snippet}")
    if l.error:
        print(f" • Error:           {l.error}")
    print()


def run_batch_instagram(input_csv: str, col: str, output_csv: str, threads: int = 4) -> None:
    in_path = Path(input_csv)
    if not in_path.is_file():
        print(f"Error: Input file {input_csv} not found.", file=sys.stderr)
        sys.exit(1)

    with open(in_path, "r", encoding="utf-8-sig") as f:
        reader = list(csv.DictReader(f))

    if not reader:
        print("Input CSV is empty.", file=sys.stderr)
        return

    fieldnames = list(reader[0].keys())
    for extra in ["ig_followers", "ig_verified", "ig_emails", "ig_bio"]:
        if extra not in fieldnames:
            fieldnames.append(extra)

    scraper = InstagramPublicScraper()
    print(f"Enriching {len(reader)} rows with Instagram data (threads={threads})...")

    def enrich_row(row: Dict[str, Any]) -> Dict[str, Any]:
        target = row.get(col, "").strip()
        if target:
            prof = scraper.scrape_profile(target)
            row["ig_followers"] = prof.followers
            row["ig_verified"] = "true" if prof.is_verified else "false"
            row["ig_emails"] = "; ".join(prof.emails)
            row["ig_bio"] = prof.bio
        return row

    enriched_rows = []
    with ThreadPoolExecutor(max_workers=threads) as executor:
        futures = {executor.submit(enrich_row, r): r for r in reader}
        for future in as_completed(futures):
            enriched_rows.append(future.result())

    out_path = Path(output_csv)
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(enriched_rows)

    print(f"✅ Successfully wrote {len(enriched_rows)} enriched rows to {output_csv}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Public Social Media Inspector & Search Dorker (Ban-Free)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", help="Platform command")

    # instagram
    ig_parser = subparsers.add_parser("instagram", help="Inspect public Instagram profile")
    ig_parser.add_argument("handle", help="Instagram username or URL (e.g. starbucks or https://instagram.com/starbucks)")
    ig_parser.add_argument("--json", action="store_true", help="Output as JSON")

    # linkedin
    li_parser = subparsers.add_parser("linkedin", help="Find LinkedIn company profile via search dorking")
    li_parser.add_argument("company", help="Company name (e.g. 'Blue Tokai Coffee Roasters')")
    li_parser.add_argument("--location", help="City or region filter (e.g. 'Mumbai')")
    li_parser.add_argument("--json", action="store_true", help="Output as JSON")

    # batch
    batch_parser = subparsers.add_parser("batch", help="Batch enrich CSV file")
    batch_parser.add_argument("--platform", choices=["instagram", "linkedin"], required=True)
    batch_parser.add_argument("--input", required=True, help="Input CSV path")
    batch_parser.add_argument("--col", required=True, help="Column name containing handles or company names")
    batch_parser.add_argument("--output", help="Output CSV path (defaults to <input>_social.csv)")
    batch_parser.add_argument("--threads", type=int, default=4, help="Worker threads")

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        return 0

    if args.command == "instagram":
        scraper = InstagramPublicScraper()
        res = scraper.scrape_profile(args.handle)
        print_instagram_profile(res, as_json=args.json)
        return 0 if res.status == "ok" else 1

    if args.command == "linkedin":
        dorker = LinkedInDorker()
        lead = dorker.find_company(args.company, location=args.location)
        print_linkedin_lead(lead, as_json=args.json)
        return 0 if lead.status == "ok" else 1

    if args.command == "batch":
        out = args.output or f"{Path(args.input).stem}_social.csv"
        if args.platform == "instagram":
            run_batch_instagram(args.input, args.col, out, threads=args.threads)
        else:
            print("Batch LinkedIn dorking coming in future release. Use single lookup.", file=sys.stderr)
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
