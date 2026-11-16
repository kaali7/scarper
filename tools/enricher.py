#!/usr/bin/env python3
"""Website & Contact Lead Enricher Tool.

Visits business websites and contact pages to extract verified outreach channels:
- Email addresses (mailto + body regex)
- WhatsApp links & direct phone numbers
- Social profile links (Instagram, Facebook, LinkedIn, X/Twitter, YouTube, TikTok)

Can enrich a single website or an entire CSV file produced by the Google Maps scraper.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set
from urllib.parse import urljoin, urlparse

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

# Email regex matching standard emails while ignoring media files
EMAIL_REGEX = re.compile(
    r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+",
    re.IGNORECASE,
)

# Common invalid email domains or extensions to filter
IGNORED_EMAIL_DOMAINS = {
    "example.com",
    "domain.com",
    "wixpress.com",
    "sentry.io",
    "placeholder.com",
    "schema.org",
    "google.com",
}
IGNORED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".css", ".js"}

# Social domain identifiers
SOCIAL_PLATFORMS = {
    "instagram": ("instagram.com",),
    "facebook": ("facebook.com", "fb.com"),
    "linkedin": ("linkedin.com",),
    "twitter": ("twitter.com", "x.com"),
    "youtube": ("youtube.com", "youtu.be"),
    "tiktok": ("tiktok.com",),
}


@dataclass
class EnrichedContact:
    url: str
    status: str = "ok"
    emails: List[str] = field(default_factory=list)
    phones: List[str] = field(default_factory=list)
    whatsapp: List[str] = field(default_factory=list)
    socials: Dict[str, str] = field(default_factory=dict)
    contact_pages: List[str] = field(default_factory=list)
    error: Optional[str] = None


def clean_url(url: str) -> str:
    """Ensure URL has scheme."""
    trimmed = url.strip()
    if not trimmed:
        return ""
    if not trimmed.startswith(("http://", "https://")):
        return f"https://{trimmed}"
    return trimmed


def is_valid_email(email: str) -> bool:
    email_clean = email.strip().lower()
    if any(email_clean.endswith(ext) for ext in IGNORED_EXTENSIONS):
        return False
    domain = email_clean.split("@")[-1]
    if domain in IGNORED_EMAIL_DOMAINS:
        return False
    if len(email_clean) < 6 or len(email_clean) > 80:
        return False
    return True


def extract_social_links(soup: BeautifulSoup, base_url: str) -> Dict[str, str]:
    socials: Dict[str, str] = {}
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        parsed = urlparse(href)
        netloc = parsed.netloc.lower()

        for platform, domains in SOCIAL_PLATFORMS.items():
            if platform in socials:
                continue
            if any(d in netloc for d in domains):
                path = parsed.path.strip("/")
                # Skip generic share or home links
                if path and not path.startswith(("share", "sharer", "intent", "home", "search")):
                    socials[platform] = href
    return socials


def extract_whatsapp_links(soup: BeautifulSoup) -> List[str]:
    wa_links: Set[str] = set()
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if "wa.me/" in href or "api.whatsapp.com/send" in href or href.startswith("whatsapp:"):
            wa_links.add(href)
    return sorted(wa_links)


def find_contact_page_links(soup: BeautifulSoup, base_url: str) -> List[str]:
    contact_keywords = {"contact", "about", "reach", "support", "get-in-touch", "location"}
    found_urls: Set[str] = set()

    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
            continue
        full_url = urljoin(base_url, href)
        parsed = urlparse(full_url)
        # Only crawl same host
        if parsed.netloc.lower() == urlparse(base_url).netloc.lower():
            path_lower = parsed.path.lower()
            if any(kw in path_lower for kw in contact_keywords):
                found_urls.add(full_url)
                if len(found_urls) >= 3:
                    break
    return list(found_urls)


def scrape_website(url: str, crawl_subpages: bool = True, timeout: int = 10) -> EnrichedContact:
    """Scrape contact channels from a business website."""
    target_url = clean_url(url)
    if not target_url:
        return EnrichedContact(url=url, status="error", error="Empty URL")

    if requests is None or BeautifulSoup is None:
        return EnrichedContact(
            url=url,
            status="error",
            error="Missing dependencies: run 'pip install requests beautifulsoup4'",
        )

    headers = {"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"}
    session = requests.Session()

    try:
        resp = session.get(target_url, headers=headers, timeout=timeout, allow_redirects=True)
        if resp.status_code >= 400:
            return EnrichedContact(url=target_url, status="failed", error=f"HTTP {resp.status_code}")
    except Exception as exc:
        return EnrichedContact(url=target_url, status="failed", error=str(exc))

    html = resp.text
    soup = BeautifulSoup(html, "html.parser")

    # 1. Emails
    found_emails: Set[str] = set()
    for mailto in soup.select('a[href^="mailto:"]'):
        href = mailto.get("href", "")
        email = href.replace("mailto:", "").split("?")[0].strip()
        if is_valid_email(email):
            found_emails.add(email)

    for match in EMAIL_REGEX.findall(html):
        if is_valid_email(match):
            found_emails.add(match)

    # 2. Phones
    found_phones: Set[str] = set()
    for tel in soup.select('a[href^="tel:"]'):
        p = tel.get("href", "").replace("tel:", "").strip()
        if len(p) >= 7:
            found_phones.add(p)

    # 3. WhatsApp & Socials
    whatsapp_links = extract_whatsapp_links(soup)
    social_links = extract_social_links(soup, target_url)

    # 4. Crawl subpages if needed and emails are sparse
    contact_subpages = find_contact_page_links(soup, target_url)
    if crawl_subpages and len(found_emails) == 0 and contact_subpages:
        for sub_url in contact_subpages[:2]:
            try:
                sub_resp = session.get(sub_url, headers=headers, timeout=timeout)
                if sub_resp.status_code < 400:
                    sub_soup = BeautifulSoup(sub_resp.text, "html.parser")
                    for m in sub_soup.select('a[href^="mailto:"]'):
                        em = m.get("href", "").replace("mailto:", "").split("?")[0].strip()
                        if is_valid_email(em):
                            found_emails.add(em)
                    for match in EMAIL_REGEX.findall(sub_resp.text):
                        if is_valid_email(match):
                            found_emails.add(match)
                    # Also collect any extra socials
                    for plat, link in extract_social_links(sub_soup, sub_url).items():
                        if plat not in social_links:
                            social_links[plat] = link
            except Exception:
                continue

    return EnrichedContact(
        url=target_url,
        status="ok",
        emails=sorted(found_emails),
        phones=sorted(found_phones),
        whatsapp=whatsapp_links,
        socials=social_links,
        contact_pages=contact_subpages,
    )


def enrich_csv(
    input_csv: Path,
    output_csv: Optional[Path] = None,
    url_column: str = "website",
    max_workers: int = 8,
) -> Path:
    """Enrich an entire CSV file from map_scraper with contact and social channels."""
    if not input_csv.is_file():
        raise FileNotFoundError(f"CSV file not found: {input_csv}")

    out_path = output_csv or input_csv.with_name(f"{input_csv.stem}_enriched.csv")

    with open(input_csv, "r", encoding="utf-8-sig", errors="replace") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        fieldnames = list(reader.fieldnames or [])

    new_fields = [
        "enriched_emails",
        "whatsapp",
        "instagram",
        "facebook",
        "linkedin",
        "twitter",
        "youtube",
    ]
    for nf in new_fields:
        if nf not in fieldnames:
            fieldnames.append(nf)

    print(f"Enriching {len(rows)} leads from '{input_csv.name}' with {max_workers} concurrent workers...")

    # Worker task
    def process_row(idx: int, row: Dict[str, str]) -> tuple[int, EnrichedContact]:
        web = row.get(url_column, "").strip()
        if not web:
            return idx, EnrichedContact(url="")
        return idx, scrape_website(web, crawl_subpages=True)

    enriched_map: Dict[int, EnrichedContact] = {}
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(process_row, i, r): i for i, r in enumerate(rows)}
        done_count = 0
        for fut in as_completed(futures):
            idx, res = fut.result()
            enriched_map[idx] = res
            done_count += 1
            if done_count % 10 == 0 or done_count == len(rows):
                print(f"  Progress: {done_count}/{len(rows)} websites processed")

    # Update rows
    for i, row in enumerate(rows):
        res = enriched_map.get(i)
        if res and res.status == "ok":
            row["enriched_emails"] = ", ".join(res.emails)
            row["whatsapp"] = ", ".join(res.whatsapp)
            row["instagram"] = res.socials.get("instagram", "")
            row["facebook"] = res.socials.get("facebook", "")
            row["linkedin"] = res.socials.get("linkedin", "")
            row["twitter"] = res.socials.get("twitter", "")
            row["youtube"] = res.socials.get("youtube", "")

    with open(out_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Enriched CSV successfully saved to: {out_path}")
    return out_path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Website & Contact Lead Enricher",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--url", help="Single website URL to inspect and extract contacts")
    group.add_argument("--csv", help="Input CSV path from Google Maps scraper to enrich")

    parser.add_argument("--output", help="Output CSV path (default: <name>_enriched.csv)")
    parser.add_argument("--column", default="website", help="Column name containing website URL (default: website)")
    parser.add_argument("--workers", type=int, default=8, help="Number of concurrent worker threads (default: 8)")
    parser.add_argument("--json", action="store_true", help="Print JSON output for --url mode")

    args = parser.parse_args()

    if args.url:
        result = scrape_website(args.url)
        if args.json:
            print(json.dumps(asdict(result), indent=2))
        else:
            print(f"\nEnrichment Results for: {result.url}")
            print("=" * 60)
            print(f"Status   : {result.status} {f'({result.error})' if result.error else ''}")
            print(f"Emails   : {', '.join(result.emails) if result.emails else 'None found'}")
            print(f"Phones   : {', '.join(result.phones) if result.phones else 'None found'}")
            print(f"WhatsApp : {', '.join(result.whatsapp) if result.whatsapp else 'None found'}")
            print("Social Profiles:")
            for platform, link in result.socials.items():
                print(f"  • {platform.capitalize():<10}: {link}")
            if result.contact_pages:
                print("Contact Subpages:")
                for page in result.contact_pages:
                    print(f"  • {page}")
            print()
        return 0

    if args.csv:
        enrich_csv(
            Path(args.csv),
            Path(args.output) if args.output else None,
            url_column=args.column,
            max_workers=args.workers,
        )
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
