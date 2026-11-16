"""Safe Public Instagram Metadata Inspector.

Extracts public profile metadata (bio, follower count, category, verified status,
contact emails) completely anonymously without an Instagram account or login,
eliminating any risk of account bans.
"""

from __future__ import annotations

import json
import re
import urllib.parse
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    import urllib.request
    HAS_REQUESTS = False

try:
    import instaloader
    HAS_INSTALOADER = True
except ImportError:
    HAS_INSTALOADER = False

from bs4 import BeautifulSoup

EMAIL_REGEX = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+", re.IGNORECASE)
PHONE_REGEX = re.compile(r"(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}")


@dataclass
class InstagramProfile:
    username: str
    url: str
    full_name: str = ""
    bio: str = ""
    followers: str = ""
    following: str = ""
    posts_count: str = ""
    is_verified: bool = False
    profile_pic_url: str = ""
    external_url: str = ""
    emails: List[str] = field(default_factory=list)
    phones: List[str] = field(default_factory=list)
    status: str = "ok"
    error: Optional[str] = None


class InstagramPublicScraper:
    """Anonymous public profile scraper via HTML open graph and JSON metadata."""

    def __init__(self, timeout: float = 10.0):
        self.timeout = timeout
        self.headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
        }

    @staticmethod
    def clean_handle(handle_or_url: str) -> str:
        s = handle_or_url.strip()
        if "instagram.com/" in s:
            match = re.search(r"instagram\.com/([a-zA-Z0-9_.]+)", s)
            if match:
                return match.group(1).rstrip("/")
        s = s.lstrip("@").strip("/ ")
        return s

    def scrape_profile(self, handle_or_url: str) -> InstagramProfile:
        username = self.clean_handle(handle_or_url)
        url = f"https://www.instagram.com/{username}/"

        if not username:
            return InstagramProfile(
                username=handle_or_url,
                url=url,
                status="error",
                error="Invalid username or URL",
            )

        html = self._fetch_html(url)
        if not html:
            # Try instaloader anonymous mode fallback
            if HAS_INSTALOADER:
                res = self._scrape_via_instaloader(username)
                if res:
                    return res
            return InstagramProfile(
                username=username,
                url=url,
                status="error",
                error="Could not fetch Instagram profile page (rate limited or connection error)",
            )

        parsed = self._parse_html(username, url, html)
        # If HTML didn't get follower count, try instaloader
        if not parsed.followers and HAS_INSTALOADER:
            loader_res = self._scrape_via_instaloader(username)
            if loader_res and loader_res.followers:
                return loader_res
        return parsed

    def _scrape_via_instaloader(self, username: str) -> Optional[InstagramProfile]:
        if not HAS_INSTALOADER:
            return None
        try:
            L = instaloader.Instaloader(
                download_pictures=False,
                download_videos=False,
                download_video_thumbnails=False,
                download_geotags=False,
                download_comments=False,
                save_metadata=False,
                compress_json=False,
            )
            prof = instaloader.Profile.from_username(L.context, username)
            bio = prof.biography or ""
            emails = EMAIL_REGEX.findall(bio)
            phones = PHONE_REGEX.findall(bio)
            return InstagramProfile(
                username=username,
                url=f"https://www.instagram.com/{username}/",
                full_name=prof.full_name or "",
                bio=bio,
                followers=str(prof.followers),
                following=str(prof.followees),
                posts_count=str(prof.mediacount),
                is_verified=bool(prof.is_verified),
                profile_pic_url=prof.profile_pic_url or "",
                external_url=prof.external_url or "",
                emails=sorted(list(set(e.lower() for e in emails))),
                phones=sorted(list(set(p.strip() for p in phones))),
                status="ok",
            )
        except Exception:
            return None

    def _fetch_html(self, url: str) -> Optional[str]:
        try:
            if HAS_REQUESTS:
                resp = requests.get(url, headers=self.headers, timeout=self.timeout)
                if resp.status_code == 200:
                    return resp.text
                elif resp.status_code == 404:
                    return None
                return resp.text
            else:
                req = urllib.request.Request(url, headers=self.headers)
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    return r.read().decode("utf-8", errors="replace")
        except Exception:
            return None

    def _parse_html(self, username: str, url: str, html: str) -> InstagramProfile:
        soup = BeautifulSoup(html, "html.parser")
        profile = InstagramProfile(username=username, url=url)

        # 1. Parse OpenGraph meta tags
        og_desc = soup.find("meta", property="og:description")
        og_title = soup.find("meta", property="og:title")
        og_image = soup.find("meta", property="og:image")

        desc_content = og_desc.get("content", "") if og_desc else ""
        title_content = og_title.get("content", "") if og_title else ""

        if og_image:
            profile.profile_pic_url = og_image.get("content", "")

        # Format typical for og:description:
        # "15K Followers, 200 Following, 450 Posts - See Instagram photos and videos from Name (@handle)"
        # or "15M Followers, 240 Following, 1,234 Posts - ..."
        stats_match = re.search(
            r"([\d.,KMkm]+)\s*Followers,\s*([\d.,KMkm]+)\s*Following,\s*([\d.,KMkm]+)\s*Posts",
            desc_content,
            re.IGNORECASE,
        )
        if stats_match:
            profile.followers = stats_match.group(1)
            profile.following = stats_match.group(2)
            profile.posts_count = stats_match.group(3)

        # Title format: "Full Name (@username) • Instagram photos and videos"
        title_match = re.search(r"^(.*?)(?:\s*\(@|\s*•|\s*-)", title_content)
        if title_match:
            profile.full_name = title_match.group(1).strip()
        else:
            profile.full_name = title_content

        # 2. Check meta description for bio snippet
        meta_desc = soup.find("meta", attrs={"name": "description"})
        if meta_desc:
            meta_text = meta_desc.get("content", "")
            # Sometimes contains bio text
            if '"' in meta_text:
                parts = meta_text.split('"', 2)
                if len(parts) > 1 and parts[1].strip():
                    profile.bio = parts[1].strip()
            elif not profile.bio and desc_content:
                profile.bio = desc_content

        # 3. Check JSON-LD script if available
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string or "")
                if isinstance(data, dict):
                    if data.get("@type") == "Person" or "description" in data:
                        profile.bio = profile.bio or data.get("description", "")
                        profile.full_name = profile.full_name or data.get("name", "")
                        profile.external_url = profile.external_url or data.get("url", "")
            except Exception:
                pass

        # 4. Extract emails & phones from bio
        all_text = f"{profile.bio} {desc_content}"
        emails = EMAIL_REGEX.findall(all_text)
        phones = PHONE_REGEX.findall(all_text)

        profile.emails = sorted(list(set(e.lower() for e in emails if not e.endswith((".png", ".jpg")))))
        profile.phones = sorted(list(set(p.strip() for p in phones if len(p.strip()) >= 8)))

        # Verified badge hint
        if "verified" in html.lower() and ('aria-label="Verified"' in html or 'title="Verified"' in html):
            profile.is_verified = True

        return profile
