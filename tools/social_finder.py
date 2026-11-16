#!/usr/bin/env python3
"""Cross-Platform Social Media Profile Finder.

Probes public profile endpoints across major social networks to discover active
brand accounts for a given business name, handle, or username.
"""

from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from typing import Dict, List, Optional

try:
    import requests
except ImportError:
    requests = None

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# Standard URL formats for public platforms
PLATFORM_TEMPLATES = {
    "instagram": "https://www.instagram.com/{handle}/",
    "facebook": "https://www.facebook.com/{handle}",
    "linkedin": "https://www.linkedin.com/company/{handle}",
    "twitter": "https://x.com/{handle}",
    "youtube": "https://www.youtube.com/@{handle}",
    "tiktok": "https://www.tiktok.com/@{handle}",
    "github": "https://github.com/{handle}",
    "pinterest": "https://www.pinterest.com/{handle}/",
}


@dataclass
class PlatformCheckResult:
    platform: str
    url: str
    exists: bool
    status_code: int


def clean_handle(raw: str) -> str:
    cleaned = raw.strip().lower()
    for char in [" ", "-", ".", "_"]:
        # standard clean for username probe
        pass
    return re_sub(r"[^a-zA-Z0-9._-]", "", cleaned)


def re_sub(pattern: str, repl: str, string: str) -> str:
    import re
    return re.sub(pattern, repl, string)


def check_platform(platform: str, handle: str, timeout: int = 6) -> PlatformCheckResult:
    url_template = PLATFORM_TEMPLATES.get(platform)
    if not url_template:
        return PlatformCheckResult(platform=platform, url="", exists=False, status_code=0)

    url = url_template.format(handle=handle)
    headers = {"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"}

    if requests is None:
        return PlatformCheckResult(platform=platform, url=url, exists=False, status_code=0)

    try:
        resp = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
        # 200 usually indicates existence, 404 indicates missing
        exists = resp.status_code == 200
        # Platform-specific false-positive filtering
        if platform == "twitter" and ("This account doesn’t exist" in resp.text):
            exists = False
        elif platform == "instagram" and ("Page Not Found" in resp.text):
            exists = False
        return PlatformCheckResult(platform=platform, url=url, exists=exists, status_code=resp.status_code)
    except Exception:
        return PlatformCheckResult(platform=platform, url=url, exists=False, status_code=0)


def scan_social_presence(handle: str, max_workers: int = 8) -> List[PlatformCheckResult]:
    clean = clean_handle(handle)
    results: List[PlatformCheckResult] = []

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(check_platform, platform, clean): platform
            for platform in PLATFORM_TEMPLATES
        }
        for fut in as_completed(futures):
            results.append(fut.result())

    # Sort results deterministically
    results.sort(key=lambda r: r.platform)
    return results


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Cross-Platform Social Media Profile Finder",
    )
    parser.add_argument("handle", help="Business name or username handle to check")
    parser.add_argument("--json", action="store_true", help="Output results as JSON")

    args = parser.parse_args()
    results = scan_social_presence(args.handle)

    if args.json:
        data = {
            "handle": args.handle,
            "profiles": [asdict(r) for r in results],
            "found": [asdict(r) for r in results if r.exists],
        }
        print(json.dumps(data, indent=2))
    else:
        print(f"\nSocial Media Discovery for: '{args.handle}'")
        print("=" * 60)
        found_any = False
        for r in results:
            badge = "✓ FOUND" if r.exists else "✗ Not Found"
            print(f" • {r.platform.capitalize():<12} {badge:<14} {r.url}")
            if r.exists:
                found_any = True
        print()
        if not found_any:
            print("No public profiles detected on checked platforms.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
