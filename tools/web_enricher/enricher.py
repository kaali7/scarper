"""Website & Contact Lead Enricher.

Extracts official contact details (emails, WhatsApp, phone numbers, and social media handles)
from company websites without authentication or ban risks.
"""

from __future__ import annotations

import re
import urllib.parse
from dataclasses import asdict, dataclass, field
from typing import Dict, List, Optional, Set

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    import urllib.request
    HAS_REQUESTS = False

try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False


EMAIL_REGEX = re.compile(
    r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+",
    re.IGNORECASE,
)

PHONE_REGEX = re.compile(
    r"(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}",
)

IGNORE_EMAIL_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".css", ".js", ".woff", ".woff2"}
DUMMY_EMAILS = {"user@domain.com", "example@example.com", "email@example.com", "name@domain.com", "sentry@io"}


@dataclass
class EnrichedContact:
    url: str
    emails: List[str] = field(default_factory=list)
    phones: List[str] = field(default_factory=list)
    whatsapp: List[str] = field(default_factory=list)
    socials: Dict[str, str] = field(default_factory=dict)
    pages_visited: List[str] = field(default_factory=list)
    status: str = "ok"
    error: Optional[str] = None


class WebEnricher:
    """Visits homepage and key contact subpages to extract structured leads."""

    def __init__(self, timeout: float = 10.0, max_pages: int = 3):
        self.timeout = timeout
        self.max_pages = max_pages
        self.headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }

    def _fetch_html(self, url: str) -> Optional[str]:
        if not url.startswith(("http://", "https://")):
            url = f"https://{url}"
        try:
            if HAS_REQUESTS:
                resp = requests.get(url, headers=self.headers, timeout=self.timeout, allow_redirects=True)
                if resp.status_code < 400:
                    return resp.text
            else:
                req = urllib.request.Request(url, headers=self.headers)
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    return r.read().decode("utf-8", errors="replace")
        except Exception:
            # Try http fallback if https failed
            if url.startswith("https://"):
                try:
                    fallback_url = "http://" + url[8:]
                    if HAS_REQUESTS:
                        r = requests.get(fallback_url, headers=self.headers, timeout=self.timeout)
                        if r.status_code < 400:
                            return r.text
                except Exception:
                    pass
        return None

    def _clean_emails(self, raw_emails: Set[str]) -> List[str]:
        cleaned = set()
        for em in raw_emails:
            e = em.strip().lower().rstrip(".,;:")
            if not e or len(e) > 80:
                continue
            if any(e.endswith(ext) for ext in IGNORE_EMAIL_EXTS):
                continue
            if e in DUMMY_EMAILS or "sentry" in e or "wixpress" in e:
                continue
            cleaned.add(e)
        return sorted(cleaned)

    def _extract_from_html(self, html: str, base_url: str) -> tuple[Set[str], Set[str], Set[str], Dict[str, str], List[str]]:
        emails = set(EMAIL_REGEX.findall(html))
        phones = set()
        whatsapp = set()
        socials: Dict[str, str] = {}
        contact_links: List[str] = []

        if HAS_BS4:
            soup = BeautifulSoup(html, "html.parser")

            # Extract mailto links
            for a in soup.find_all("a", href=True):
                href = a["href"].strip()

                if href.startswith("mailto:"):
                    em = href.split(":", 1)[1].split("?")[0].strip()
                    if em:
                        emails.add(em)

                elif href.startswith("tel:"):
                    ph = href.split(":", 1)[1].strip()
                    if ph:
                        phones.add(ph)

                elif "wa.me/" in href or "api.whatsapp.com" in href:
                    whatsapp.add(href)

                # Social profile detection
                h_low = href.lower()
                if "instagram.com/" in h_low and not any(x in h_low for x in ("/p/", "/explore/", "/reel/")):
                    socials["instagram"] = href
                elif "linkedin.com/company/" in h_low or "linkedin.com/in/" in h_low:
                    socials["linkedin"] = href
                elif "facebook.com/" in h_low and not any(x in h_low for x in ("/sharer", "/share.php")):
                    socials["facebook"] = href
                elif ("twitter.com/" in h_low or "x.com/" in h_low) and not any(x in h_low for x in ("/intent/", "/share")):
                    socials["twitter"] = href
                elif "youtube.com/" in h_low and not any(x in h_low for x in ("/watch", "/embed")):
                    socials["youtube"] = href
                elif "tiktok.com/@" in h_low:
                    socials["tiktok"] = href

                # Find candidate subpages (contact, about)
                text = a.get_text(strip=True).lower()
                if any(k in href.lower() or k in text for k in ("contact", "about", "reach-us", "get-in-touch")):
                    full_link = urllib.parse.urljoin(base_url, href)
                    # Stay on same domain
                    if urllib.parse.urlparse(full_link).netloc == urllib.parse.urlparse(base_url).netloc:
                        if full_link != base_url and full_link not in contact_links:
                            contact_links.append(full_link)

        return emails, phones, whatsapp, socials, contact_links

    def enrich(self, url: str) -> EnrichedContact:
        """Crawl the website homepage and candidate contact pages."""
        if not url:
            return EnrichedContact(url="", status="failed", error="Empty URL")

        all_emails: Set[str] = set()
        all_phones: Set[str] = set()
        all_whatsapp: Set[str] = set()
        all_socials: Dict[str, str] = {}
        visited: List[str] = []

        # 1. Fetch homepage
        html = self._fetch_html(url)
        if not html:
            return EnrichedContact(url=url, status="failed", error="Could not connect to website")

        visited.append(url)
        emails, phones, wa, socials, subpages = self._extract_from_html(html, url)
        all_emails.update(emails)
        all_phones.update(phones)
        all_whatsapp.update(wa)
        all_socials.update(socials)

        # 2. Fetch contact/about subpages if needed
        for sub in subpages[: self.max_pages - 1]:
            if sub in visited:
                continue
            sub_html = self._fetch_html(sub)
            if sub_html:
                visited.append(sub)
                s_emails, s_phones, s_wa, s_socials, _ = self._extract_from_html(sub_html, sub)
                all_emails.update(s_emails)
                all_phones.update(s_phones)
                all_whatsapp.update(s_wa)
                for k, v in s_socials.items():
                    all_socials.setdefault(k, v)

        return EnrichedContact(
            url=url,
            emails=self._clean_emails(all_emails),
            phones=sorted(all_phones),
            whatsapp=sorted(all_whatsapp),
            socials=all_socials,
            pages_visited=visited,
            status="ok",
        )
