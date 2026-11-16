#!/usr/bin/env python3
"""Unified Tools Registry and Scraper Dispatcher.

Orchestrates multiple scrapers (Google Maps, Social Media, etc.) under a unified
CLI and programmatic interface for desktop apps, scripts, and AI agents.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
import sys
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT_DIR = Path(__file__).resolve().parent


@dataclass
class ToolMetadata:
    name: str
    category: str
    description: str
    version: str = "1.0.0"
    directory: str = ""
    entry_point: str = ""
    installed: bool = False
    capabilities: List[str] = field(default_factory=list)


class BaseScraperTool(ABC):
    """Abstract base class for all scraper tools registered in this project."""

    name: str
    category: str
    description: str
    version: str = "1.0.0"

    def __init__(self, root_dir: Optional[Path] = None):
        self.root_dir = root_dir or ROOT_DIR

    @abstractmethod
    def is_installed(self) -> bool:
        """Return True if dependencies and files for this tool are ready."""
        ...

    @abstractmethod
    def get_metadata(self) -> ToolMetadata:
        """Return structured tool metadata."""
        ...

    @abstractmethod
    def run(self, args: List[str]) -> int:
        """Execute the scraper CLI with the given raw command line arguments."""
        ...

    @abstractmethod
    def get_schema(self) -> Dict[str, Any]:
        """Return JSON schema for AI tool calling / function calling."""
        ...

    def status(self) -> Dict[str, Any]:
        """Check status of this scraper's server or environment."""
        return {"name": self.name, "installed": self.is_installed()}


class MapScraperTool(BaseScraperTool):
    """Google Maps Scraper Kit tool adapter."""

    name = "map"
    category = "local_business"
    description = "Google Maps scraper engine for local businesses, contacts, and reviews via CDP."
    version = "2.0.0"

    def __init__(self, root_dir: Optional[Path] = None):
        super().__init__(root_dir)
        # Check both restructured directory (map_scraper) and legacy root
        sub_dir = self.root_dir / "map_scraper"
        self.tool_dir = sub_dir if (sub_dir / "engine").is_dir() else self.root_dir
        self.scrape_script = self.tool_dir / "scripts" / "scrape.py"
        self.engine_script = self.tool_dir / "scripts" / "engine.py"
        self.serve_script = self.tool_dir / "engine" / "serve.py"

    def is_installed(self) -> bool:
        return self.scrape_script.is_file() and self.serve_script.is_file()

    def get_metadata(self) -> ToolMetadata:
        return ToolMetadata(
            name=self.name,
            category=self.category,
            description=self.description,
            version=self.version,
            directory=str(self.tool_dir),
            entry_point=str(self.scrape_script),
            installed=self.is_installed(),
            capabilities=[
                "google_maps_search",
                "phone_extraction",
                "email_extraction",
                "social_profile_links",
                "reviews_and_ratings",
                "headless_cdp_stealth",
                "background_server_api",
            ],
        )

    def run(self, args: List[str]) -> int:
        if not self.scrape_script.is_file():
            print(f"Error: {self.scrape_script} not found.", file=sys.stderr)
            return 1

        cmd = [sys.executable, str(self.scrape_script)] + args
        return subprocess.run(cmd, cwd=str(self.tool_dir)).returncode

    def run_engine_cmd(self, action: str, *extra_args: str) -> int:
        """Run engine management commands: start, stop, restart, status."""
        if not self.engine_script.is_file():
            print(f"Error: {self.engine_script} not found.", file=sys.stderr)
            return 1
        cmd = [sys.executable, str(self.engine_script), action] + list(extra_args)
        return subprocess.run(cmd, cwd=str(self.tool_dir)).returncode

    def get_schema(self) -> Dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": "scrape_google_maps",
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "keywords": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "List of search queries, e.g. ['coffee shops in Seattle']",
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Maximum number of places to collect per keyword",
                            "default": 100,
                        },
                        "collect_emails": {
                            "type": "boolean",
                            "description": "Whether to visit websites to extract contact emails",
                            "default": False,
                        },
                        "collect_socials": {
                            "type": "boolean",
                            "description": "Whether to extract social media links from websites",
                            "default": False,
                        },
                    },
                    "required": ["keywords"],
                },
            },
        }


class EnricherTool(BaseScraperTool):
    """Website and Contact Lead Enricher tool adapter."""

    name = "enricher"
    category = "lead_enrichment"
    description = "Extracts verified emails, WhatsApp, and social profiles directly from business websites or CSVs."
    version = "1.0.0"

    def __init__(self, root_dir: Optional[Path] = None):
        super().__init__(root_dir)
        self.script_path = self.root_dir / "tools" / "enricher.py"

    def is_installed(self) -> bool:
        return self.script_path.is_file()

    def get_metadata(self) -> ToolMetadata:
        return ToolMetadata(
            name=self.name,
            category=self.category,
            description=self.description,
            version=self.version,
            directory=str(self.root_dir / "tools"),
            entry_point=str(self.script_path),
            installed=self.is_installed(),
            capabilities=[
                "website_email_extraction",
                "whatsapp_link_detection",
                "social_profile_extraction",
                "csv_batch_enrichment",
                "subpage_contact_crawler",
            ],
        )

    def run(self, args: List[str]) -> int:
        if not self.is_installed():
            print(f"Error: {self.script_path} not found.", file=sys.stderr)
            return 1
        cmd = [sys.executable, str(self.script_path)] + args
        return subprocess.run(cmd, cwd=str(self.root_dir)).returncode

    def get_schema(self) -> Dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": "enrich_website_leads",
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {"type": "string", "description": "Single website URL to inspect"},
                        "csv": {"type": "string", "description": "Path to input CSV to enrich in batch"},
                        "workers": {"type": "integer", "description": "Worker threads", "default": 8},
                    },
                },
            },
        }


class InstagramTool(BaseScraperTool):
    """Anonymous Instagram Public Profile Inspector tool adapter."""

    name = "instagram"
    category = "social_media"
    description = "Extracts public follower counts, bios, and links anonymously without account login."
    version = "1.0.0"

    def __init__(self, root_dir: Optional[Path] = None):
        super().__init__(root_dir)
        self.script_path = self.root_dir / "tools" / "instagram.py"

    def is_installed(self) -> bool:
        return self.script_path.is_file()

    def get_metadata(self) -> ToolMetadata:
        return ToolMetadata(
            name=self.name,
            category=self.category,
            description=self.description,
            version=self.version,
            directory=str(self.root_dir / "tools"),
            entry_point=str(self.script_path),
            installed=self.is_installed(),
            capabilities=[
                "public_follower_counts",
                "bio_and_category",
                "verified_badge",
                "external_links",
                "zero_login_stealth",
            ],
        )

    def run(self, args: List[str]) -> int:
        if not self.is_installed():
            print(f"Error: {self.script_path} not found.", file=sys.stderr)
            return 1
        cmd = [sys.executable, str(self.script_path)] + args
        return subprocess.run(cmd, cwd=str(self.root_dir)).returncode

    def get_schema(self) -> Dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": "inspect_instagram_profile",
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "handle": {"type": "string", "description": "Instagram handle or URL to inspect"},
                    },
                    "required": ["handle"],
                },
            },
        }


class SearchDorkerTool(BaseScraperTool):
    """Public Search Dorker & B2B Lead Finder tool adapter."""

    name = "dorker"
    category = "b2b_osint"
    description = "Discovers LinkedIn company profiles, founders, and decision-makers via search queries."
    version = "1.0.0"

    def __init__(self, root_dir: Optional[Path] = None):
        super().__init__(root_dir)
        self.script_path = self.root_dir / "tools" / "search_dorker.py"

    def is_installed(self) -> bool:
        return self.script_path.is_file()

    def get_metadata(self) -> ToolMetadata:
        return ToolMetadata(
            name=self.name,
            category=self.category,
            description=self.description,
            version=self.version,
            directory=str(self.root_dir / "tools"),
            entry_point=str(self.script_path),
            installed=self.is_installed(),
            capabilities=[
                "duckduckgo_search_queries",
                "linkedin_company_lookup",
                "decision_maker_dorking",
                "ban_free_osint",
            ],
        )

    def run(self, args: List[str]) -> int:
        if not self.is_installed():
            print(f"Error: {self.script_path} not found.", file=sys.stderr)
            return 1
        cmd = [sys.executable, str(self.script_path)] + args
        return subprocess.run(cmd, cwd=str(self.root_dir)).returncode

    def get_schema(self) -> Dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": "search_b2b_dorker",
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "company": {"type": "string", "description": "Target company name"},
                        "city": {"type": "string", "description": "Optional city/location filter"},
                        "query": {"type": "string", "description": "Custom raw search dork query"},
                    },
                },
            },
        }


class SocialFinderTool(BaseScraperTool):
    """Cross-Platform Social Media Profile Finder tool adapter."""

    name = "social_finder"
    category = "social_media"
    description = "Multi-platform presence scanner across Instagram, LinkedIn, X, Facebook, YouTube, TikTok."
    version = "1.0.0"

    def __init__(self, root_dir: Optional[Path] = None):
        super().__init__(root_dir)
        self.script_path = self.root_dir / "tools" / "social_finder.py"

    def is_installed(self) -> bool:
        return self.script_path.is_file()

    def get_metadata(self) -> ToolMetadata:
        return ToolMetadata(
            name=self.name,
            category=self.category,
            description=self.description,
            version=self.version,
            directory=str(self.root_dir / "tools"),
            entry_point=str(self.script_path),
            installed=self.is_installed(),
            capabilities=[
                "cross_platform_presence",
                "brand_handle_verification",
                "multi_network_probe",
            ],
        )

    def run(self, args: List[str]) -> int:
        if not self.is_installed():
            print(f"Error: {self.script_path} not found.", file=sys.stderr)
            return 1
        cmd = [sys.executable, str(self.script_path)] + args
        return subprocess.run(cmd, cwd=str(self.root_dir)).returncode

    def get_schema(self) -> Dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": "find_social_profiles",
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "handle": {"type": "string", "description": "Brand name or username to probe"},
                    },
                    "required": ["handle"],
                },
            },
        }


class ToolsRegistry:
    """Registry managing all available scraper tools."""

    def __init__(self, root_dir: Optional[Path] = None):
        self.root_dir = root_dir or ROOT_DIR
        self._tools: Dict[str, BaseScraperTool] = {}
        self._register_builtins()

    def _register_builtins(self) -> None:
        self.register(MapScraperTool(self.root_dir))
        self.register(EnricherTool(self.root_dir))
        self.register(InstagramTool(self.root_dir))
        self.register(SearchDorkerTool(self.root_dir))
        self.register(SocialFinderTool(self.root_dir))

    def register(self, tool: BaseScraperTool) -> None:
        self._tools[tool.name.lower()] = tool

    def get(self, name: str) -> Optional[BaseScraperTool]:
        name_clean = name.lower()
        # Aliases
        aliases = {
            "maps": "map",
            "google_maps": "map",
            "gmaps": "map",
            "enrich": "enricher",
            "website_enricher": "enricher",
            "ig": "instagram",
            "insta": "instagram",
            "search_dorker": "dorker",
            "linkedin_dorker": "dorker",
            "social": "social_finder",
            "socials": "social_finder",
            "finder": "social_finder",
        }
        name_clean = aliases.get(name_clean, name_clean)
        return self._tools.get(name_clean)

    def list_tools(self) -> List[ToolMetadata]:
        return [tool.get_metadata() for tool in self._tools.values()]

    def list_schemas(self) -> List[Dict[str, Any]]:
        return [tool.get_schema() for tool in self._tools.values()]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Unified Tools Registry & Scraper Dispatcher",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python tools.py list
  python tools.py run map "coffee shops in Miami" --depth 2
  python tools.py start map --port 8080
  python tools.py stop map
  python tools.py status map
  python tools.py schema map
        """,
    )
    subparsers = parser.add_subparsers(dest="command", help="Command to execute")

    # list
    list_p = subparsers.add_parser("list", help="List all registered tools")
    list_p.add_argument("--json", action="store_true", help="Output as JSON")

    # info
    info_p = subparsers.add_parser("info", help="Show details for a specific tool")
    info_p.add_argument("tool", help="Tool name (map, social, etc.)")

    # schema
    schema_p = subparsers.add_parser("schema", help="Export AI tool JSON schemas")
    schema_p.add_argument("tool", nargs="?", help="Optional specific tool name")

    # run
    run_p = subparsers.add_parser("run", help="Run a scraper tool")
    run_p.add_argument("tool", help="Tool name to run (map, social, etc.)")
    run_p.add_argument("args", nargs=argparse.REMAINDER, help="Arguments passed to the scraper")

    # start
    start_p = subparsers.add_parser("start", help="Start background server for a tool (e.g. map)")
    start_p.add_argument("tool", help="Tool name (e.g. map)")
    start_p.add_argument("args", nargs=argparse.REMAINDER, help="Extra arguments")

    # stop
    stop_p = subparsers.add_parser("stop", help="Stop background server for a tool")
    stop_p.add_argument("tool", help="Tool name (e.g. map)")

    # status
    status_p = subparsers.add_parser("status", help="Check status for a tool")
    status_p.add_argument("tool", help="Tool name (e.g. map)")

    parsed, unknown = parser.parse_known_args()
    if not parsed.command:
        parser.print_help()
        return 0

    registry = ToolsRegistry()

    if parsed.command == "list":
        tools = registry.list_tools()
        if getattr(parsed, "json", False):
            print(json.dumps([asdict(t) for t in tools], indent=2))
        else:
            print("\nRegistered Scraper Tools:")
            print("=" * 65)
            for t in tools:
                status_badge = "[Ready]" if t.installed else "[Not Installed]"
                print(f" • {t.name:<10} {status_badge:<16} {t.description}")
                print(f"   Category: {t.category} | Directory: {t.directory}")
                if t.capabilities:
                    print(f"   Capabilities: {', '.join(t.capabilities[:4])}")
                print()
        return 0

    if parsed.command == "info":
        tool = registry.get(parsed.tool)
        if not tool:
            print(f"Error: Unknown tool '{parsed.tool}'. Run 'python tools.py list'.", file=sys.stderr)
            return 1
        meta = tool.get_metadata()
        print(json.dumps(asdict(meta), indent=2))
        return 0

    if parsed.command == "schema":
        if parsed.tool:
            tool = registry.get(parsed.tool)
            if not tool:
                print(f"Error: Unknown tool '{parsed.tool}'.", file=sys.stderr)
                return 1
            print(json.dumps(tool.get_schema(), indent=2))
        else:
            print(json.dumps(registry.list_schemas(), indent=2))
        return 0

    if parsed.command == "run":
        tool = registry.get(parsed.tool)
        if not tool:
            print(f"Error: Unknown tool '{parsed.tool}'. Run 'python tools.py list'.", file=sys.stderr)
            return 1
        raw_args = list(parsed.args) + unknown
        # Strip leading '--' if passed to separate subcommand arguments
        if raw_args and raw_args[0] == "--":
            raw_args = raw_args[1:]
        return tool.run(raw_args)

    if parsed.command in ("start", "stop", "status"):
        tool = registry.get(parsed.tool)
        if not tool:
            print(f"Error: Unknown tool '{parsed.tool}'.", file=sys.stderr)
            return 1
        if isinstance(tool, MapScraperTool):
            extra = list(getattr(parsed, "args", [])) + unknown
            if extra and extra[0] == "--":
                extra = extra[1:]
            return tool.run_engine_cmd(parsed.command, *extra)
        else:
            res = tool.status()
            print(json.dumps(res, indent=2))
            return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
