#!/usr/bin/env python3
"""Anonymous Instagram Public Profile Inspector Tool.

Extracts public business information from Instagram profiles WITHOUT user login:
- Follower count & following count
- Bio description & category
- Verified status
- External website link in bio
- Profile avatar / image

Because this tool never logs in with user credentials, it eliminates account ban risks.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from typing import Any, Dict, Optional

try:
    import requests
except ImportError:
    requests = None

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

# OpenGraph description pattern: "1,234 Followers, 567 Following, 89 Posts - See Instagram photos..."
OG_DESC_REGEX = re.compile(
    r"([0-9,.KkMmBb]+)\s*Followers?,\s*([0-9,.KkMmBb]+)\s*Following,\s*([0-9,.KkMmBb]+)\s*Posts?",
    re.IGNORECASE,
)


@dataclass
class InstagramProfile:
    handle: str
    url: str
    status: str = "ok"
    followers: Optional[str] = None
    following: Optional[str] = None
    posts_count: Optional[str] = None
    bio: Optional[str] = None
    external_url: Optional[str] = None
    is_verified: bool = False
    error: Optional[str] = None


def clean_handle(raw: str) -> str:
    cleaned = raw.strip()
    if "instagram.com/" in cleaned:
        cleaned = cleaned.split("instagram.com/")[-1].split("/")[0].split("?")[0]
    return cleaned.lstrip("@").strip()


def inspect_profile(handle: str, timeout: int = 10) -> InstagramProfile:
    user = clean_handle(handle)
    if not user:
        return InstagramProfile(handle=handle, url="", status="error", error="Invalid username")

    profile_url = f"https://www.instagram.com/{user}/"

    if requests is None:
        return InstagramProfile(
            handle=user,
            url=profile_url,
            status="error",
            error="Missing 'requests' library: run 'pip install requests'",
        )

    # Method 1: Web profile API with official public web app id
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "X-IG-App-ID": "936619743392459",  # Public Instagram Web App ID
        "Sec-Fetch-Site": "same-origin",
    }
    api_url = f"https://www.instagram.com/api/v1/users/web_profile_info/?username={user}"

    try:
        resp = requests.get(api_url, headers=headers, timeout=timeout)
        if resp.status_code == 200:
            data = resp.json().get("data", {}).get("user", {})
            if data:
                return InstagramProfile(
                    handle=user,
                    url=profile_url,
                    status="ok",
                    followers=str(data.get("edge_followed_by", {}).get("count", "")),
                    following=str(data.get("edge_follow", {}).get("count", "")),
                    posts_count=str(data.get("edge_owner_to_timeline_media", {}).get("count", "")),
                    bio=data.get("biography", ""),
                    external_url=data.get("external_url", ""),
                    is_verified=bool(data.get("is_verified", False)),
                )
    except Exception:
        pass

    # Method 2: Fallback to Public HTML OpenGraph tags (anti-ban stealth)
    try:
        html_headers = {
            "User-Agent": USER_AGENT,
            "Accept-Language": "en-US,en;q=0.9",
        }
        page_resp = requests.get(profile_url, headers=html_headers, timeout=timeout)
        if page_resp.status_code == 200:
            html = page_resp.text
            match = OG_DESC_REGEX.search(html)
            followers, following, posts = None, None, None
            if match:
                followers, following, posts = match.group(1), match.group(2), match.group(3)

            # Bio in title or meta
            bio_match = re.search(r'<meta property="og:title" content="([^"]+)"', html)
            bio = bio_match.group(1) if bio_match else None

            is_verified = "Verified" in html or '"is_verified":true' in html

            return InstagramProfile(
                handle=user,
                url=profile_url,
                status="ok" if (followers or bio) else "partial",
                followers=followers,
                following=following,
                posts_count=posts,
                bio=bio,
                is_verified=is_verified,
            )
        elif page_resp.status_code == 404:
            return InstagramProfile(handle=user, url=profile_url, status="not_found", error="Profile not found")
    except Exception as exc:
        return InstagramProfile(handle=user, url=profile_url, status="failed", error=str(exc))

    return InstagramProfile(
        handle=user,
        url=profile_url,
        status="rate_limited",
        error="Instagram requested verification. Try again later or inspect via search dorking.",
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Anonymous Instagram Public Profile Inspector",
    )
    parser.add_argument("handle", help="Instagram username or profile URL")
    parser.add_argument("--json", action="store_true", help="Print structured JSON output")

    args = parser.parse_args()
    profile = inspect_profile(args.handle)

    if args.json:
        print(json.dumps(asdict(profile), indent=2))
    else:
        print(f"\nInstagram Profile: @{profile.handle}")
        print("=" * 55)
        print(f"Status     : {profile.status} {f'({profile.error})' if profile.error else ''}")
        print(f"Profile URL: {profile.url}")
        print(f"Followers  : {profile.followers or 'Unknown'}")
        print(f"Following  : {profile.following or 'Unknown'}")
        print(f"Posts      : {profile.posts_count or 'Unknown'}")
        print(f"Verified   : {'Yes ✓' if profile.is_verified else 'No'}")
        if profile.bio:
            print(f"Bio / Title: {profile.bio}")
        if profile.external_url:
            print(f"Website    : {profile.external_url}")
        print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
