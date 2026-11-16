#!/usr/bin/env python3
"""CLI interface for Web & Contact Lead Enricher."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List

from enricher import EnrichedContact, WebEnricher


def enrich_single_url(url: str, enricher: WebEnricher) -> Dict[str, Any]:
    res = enricher.enrich(url)
    return asdict(res)


def enrich_csv(
    input_csv: Path,
    output_csv: Path,
    website_col: str = "website",
    concurrency: int = 5,
    enricher: Optional[WebEnricher] = None,
) -> int:
    enricher = enricher or WebEnricher()
    if not input_csv.is_file():
        print(f"Error: CSV file '{input_csv}' not found.", file=sys.stderr)
        return 1

    with open(input_csv, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        fieldnames = list(reader.fieldnames or [])

    # Identify website column
    candidates = [website_col, "website", "link", "url", "site"]
    target_col = next((c for c in candidates if c in fieldnames), None)
    if not target_col:
        print(f"Error: Could not find website column among {fieldnames}.", file=sys.stderr)
        return 1

    # Add enriched columns if not present
    new_cols = [
        "enriched_emails",
        "enriched_phones",
        "enriched_whatsapp",
        "enriched_instagram",
        "enriched_linkedin",
        "enriched_facebook",
        "enriched_twitter",
    ]
    for c in new_cols:
        if c not in fieldnames:
            fieldnames.append(c)

    print(f"Enriching {len(rows)} rows from '{input_csv}' with concurrency {concurrency}...")

    def process_row(idx: int, row: Dict[str, str]) -> tuple[int, Dict[str, str]]:
        url = row.get(target_col, "").strip()
        if url:
            contact = enricher.enrich(url)
            row["enriched_emails"] = ", ".join(contact.emails)
            row["enriched_phones"] = ", ".join(contact.phones)
            row["enriched_whatsapp"] = ", ".join(contact.whatsapp)
            row["enriched_instagram"] = contact.socials.get("instagram", "")
            row["enriched_linkedin"] = contact.socials.get("linkedin", "")
            row["enriched_facebook"] = contact.socials.get("facebook", "")
            row["enriched_twitter"] = contact.socials.get("twitter", "")
        return idx, row

    enriched_rows: Dict[int, Dict[str, str]] = {}
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = {executor.submit(process_row, i, r): i for i, r in enumerate(rows)}
        done_count = 0
        for fut in as_completed(futures):
            i, r = fut.result()
            enriched_rows[i] = r
            done_count += 1
            if done_count % 10 == 0 or done_count == len(rows):
                print(f"Progress: {done_count}/{len(rows)} enriched...")

    with open(output_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for i in range(len(rows)):
            writer.writerow(enriched_rows[i])

    print(f"Done! Saved enriched CSV to '{output_csv}'.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Web & Contact Lead Enricher")
    parser.add_argument("--url", help="Single website URL to enrich")
    parser.add_argument("--csv", help="Input CSV path from Google Maps scraper")
    parser.add_argument("--output", help="Output CSV path for enriched results")
    parser.add_argument("--concurrency", type=int, default=5, help="Number of concurrent web workers")
    parser.add_argument("--timeout", type=float, default=10.0, help="Per-page request timeout in seconds")
    parser.add_argument("--json", action="store_true", help="Print JSON output for single URL")

    args = parser.parse_args()
    enricher = WebEnricher(timeout=args.timeout)

    if args.url:
        result = enrich_single_url(args.url, enricher)
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(f"\nEnrichment results for: {result['url']}")
            print("=" * 60)
            print(f"Emails:    {', '.join(result['emails']) or 'None'}")
            print(f"Phones:    {', '.join(result['phones']) or 'None'}")
            print(f"WhatsApp:  {', '.join(result['whatsapp']) or 'None'}")
            print("Social Media:")
            for platform, link in result["socials"].items():
                print(f"  • {platform.capitalize():<10}: {link}")
            print(f"Pages visited: {len(result['pages_visited'])}")
        return 0

    if args.csv:
        out_p = Path(args.output) if args.output else Path(args.csv).with_name(f"enriched_{Path(args.csv).name}")
        return enrich_csv(Path(args.csv), out_p, concurrency=args.concurrency, enricher=enricher)

    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
