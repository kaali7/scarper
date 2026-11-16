"""Safe LinkedIn Company & Lead Finder via Public Search Dorking.

Extracts LinkedIn company profile URLs, employee counts, industry, and location
completely outside LinkedIn's authenticated environment by searching public search
engine indexes. Zero account ban risk, zero session cookie requirements.
"""

from __future__ import annotations

import html
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

from bs4 import BeautifulSoup


@dataclass
class LinkedInCompanyLead:
    query: str
    company_name: str
    linkedin_url: str = ""
    headline: str = ""
    snippet: str = ""
    employee_count_hint: str = ""
    location_hint: str = ""
    industry_hint: str = ""
    status: str = "ok"
    error: Optional[str] = None


class LinkedInDorker:
    """Discovers LinkedIn company profiles using search engine dorking."""

    def __init__(self, timeout: float = 12.0):
        self.timeout = timeout
        self.headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }

    def find_company(self, company_name: str, location: Optional[str] = None) -> LinkedInCompanyLead:
        """Search for a company's LinkedIn profile using search dorking."""
        query_parts = ['site:linkedin.com/company/', f'"{company_name}"']
        if location:
            query_parts.append(f'"{location}"')
        search_query = " ".join(query_parts)

        # Try DuckDuckGo Lite first (clean HTML, highly resilient)
        lead = self._search_duckduckgo_lite(search_query, company_name)
        if lead and lead.linkedin_url:
            return lead

        # Fallback: Bing HTML search
        lead = self._search_bing(search_query, company_name)
        if lead and lead.linkedin_url:
            return lead

        return LinkedInCompanyLead(
            query=search_query,
            company_name=company_name,
            status="not_found",
            error="No LinkedIn company profile found for this query",
        )

    def _search_duckduckgo_lite(self, query: str, company_name: str) -> Optional[LinkedInCompanyLead]:
        try:
            url = "https://lite.duckduckgo.com/lite/"
            data = urllib.parse.urlencode({"q": query}).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=data,
                headers={**self.headers, "Content-Type": "application/x-www-form-urlencoded"},
            )
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                html_text = resp.read().decode("utf-8", errors="replace")

            soup = BeautifulSoup(html_text, "html.parser")
            # Links in DuckDuckGo Lite are typically inside <a class="result-link">
            for a in soup.find_all("a"):
                href = a.get("href", "")
                if "linkedin.com/company/" in href:
                    clean_url = self._clean_linkedin_url(href)
                    headline = a.get_text(strip=True)
                    snippet = ""
                    # Next tr often contains the snippet in lite view
                    parent_td = a.find_parent("td")
                    if parent_td:
                        parent_tr = parent_td.find_parent("tr")
                        if parent_tr:
                            next_tr = parent_tr.find_next_sibling("tr")
                            if next_tr:
                                snippet = next_tr.get_text(" ", strip=True)

                    return self._build_lead(query, company_name, clean_url, headline, snippet)
        except Exception:
            pass
        return None

    def _search_bing(self, query: str, company_name: str) -> Optional[LinkedInCompanyLead]:
        try:
            encoded_query = urllib.parse.quote(query)
            url = f"https://www.bing.com/search?q={encoded_query}"
            if HAS_REQUESTS:
                resp = requests.get(url, headers=self.headers, timeout=self.timeout)
                html_text = resp.text
            else:
                req = urllib.request.Request(url, headers=self.headers)
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    html_text = resp.read().decode("utf-8", errors="replace")

            soup = BeautifulSoup(html_text, "html.parser")
            for item in soup.select("li.b_algo"):
                a = item.select_one("h2 a")
                if not a:
                    continue
                href = a.get("href", "")
                if "linkedin.com/company/" in href:
                    clean_url = self._clean_linkedin_url(href)
                    headline = a.get_text(strip=True)
                    caption = item.select_one(".b_caption p")
                    snippet = caption.get_text(" ", strip=True) if caption else ""
                    return self._build_lead(query, company_name, clean_url, headline, snippet)
        except Exception:
            pass
        return None

    @staticmethod
    def _clean_linkedin_url(raw_url: str) -> str:
        # Resolve DuckDuckGo redirect wrapper if present
        if "duckduckgo.com/l/?uddg=" in raw_url:
            parsed = urllib.parse.urlparse(raw_url)
            qs = urllib.parse.parse_qs(parsed.query)
            if "uddg" in qs:
                raw_url = qs["uddg"][0]
        # Strip query parameters and trailing slashes
        clean = raw_url.split("?")[0].rstrip("/")
        # Ensure company URL format
        match = re.search(r"https?://(?:[a-z]{2,3}\.)?linkedin\.com/company/[a-zA-Z0-9_\-\.%]+", clean)
        return match.group(0) if match else clean

    def _build_lead(
        self,
        query: str,
        company_name: str,
        url: str,
        headline: str,
        snippet: str,
    ) -> LinkedInCompanyLead:
        lead = LinkedInCompanyLead(
            query=query,
            company_name=company_name,
            linkedin_url=url,
            headline=html.unescape(headline),
            snippet=html.unescape(snippet),
        )

        full_text = f"{headline} {snippet}"

        # Extract employee counts, e.g. "11-50 employees", "10,001+ employees", "500-1,000 employees"
        emp_match = re.search(r"([\d,]+(?:\s*-\s*[\d,]+|\+)?\s*employees)", full_text, re.IGNORECASE)
        if emp_match:
            lead.employee_count_hint = emp_match.group(1).strip()

        # Extract locations / HQ
        loc_match = re.search(
            r"(?:Headquarters|based in|Location):\s*([^·\n|]+)|·\s*([A-Za-z\s,]+,\s*[A-Za-z\s]+)\s*·",
            full_text,
        )
        if loc_match:
            lead.location_hint = (loc_match.group(1) or loc_match.group(2) or "").strip()

        # Extract industry
        ind_match = re.search(r"·\s*([A-Za-z\s&]{3,30})\s*·\s*[\d,]+(?:\+|-)?[^\n·]*employees", full_text)
        if ind_match:
            lead.industry_hint = ind_match.group(1).strip()

        return lead
