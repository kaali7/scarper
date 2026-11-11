# Tech Stack Specification: Google Maps Scraper Kit — Tauri Desktop App

- **Document Path:** `c:\kali\product\scraper\my_docs\tech-stack.md`
- **Related PRD:** [prd.md](prd.md)
- **Target Project Root:** `c:\kali\product\scraper`
- **Desktop App Directory:** `c:\kali\product\scraper\desktop\`

---

## 1. High-Level Stack Summary

| Layer | Technology | Role |
|---|---|---|
| **Desktop Shell** | **Tauri v2** | Native Windows/macOS/Linux wrapper using OS WebView2 (~5–15 MB app footprint) + IPC bridge (`invoke` & events) |
| **Frontend Build & Framework** | **React 19 + TypeScript + Vite** | Fast HMR dev server, strict typing for tool schemas, CSV rows, and job state |
| **Styling & UI Primitives** | **Tailwind CSS + shadcn/ui (Radix UI) + Lucide React** | Clean desktop dashboard layout, accessible modals/popovers/dropdowns, crisp icons |
| **CSV Data Grid** | **TanStack Table v8 + TanStack Virtual** | Virtualized table rendering 5,000+ scraped rows smoothly, column toggles, sorting, filtering |
| **State & Server Cache** | **Zustand + TanStack Query** | Local UI/chat/table-filter state + async job polling and DB/CSV list caching |
| **Chat Markdown** | **react-markdown + remark-gfm** | Renders AI responses and bounded preview tables cleanly in the Groq chat panel |
| **Backend Core (Tauri)** | **Rust (`src-tauri`) + Tokio** | Async IPC commands, engine child-process lifecycle, SQLite & CSV I/O, HTTP clients, secret storage |
| **SQLite Reader (`jobs.db`)** | **rusqlite** (`bundled`) | Read-only inspection of `.engine/data/jobs.db` even when the Python engine is stopped |
| **CSV Engine** | **csv** crate | Streaming UTF-8/BOM CSV parsing, filtering (`has_phone`, search), and `csv_safe` formula-guarded export |
| **HTTP Client** | **reqwest** (`json`, `stream`, `rustls-tls`) | Calls local engine (`127.0.0.1:8080`), Nominatim geocoding fallback, and Groq Cloud API |
| **Secrets Storage** | **keyring** crate + **tauri-plugin-store** | Keeps `GROQ_API_KEY` in Windows Credential Manager (never in `.env` or git) |
| **Scraper & Browser Engine** | **Existing Python Engine** (`engine/`, `scripts/`) | Python 3.9+ stdlib HTTP/CDP engine driving installed Chrome (`chrome.exe`) |
| **AI / LLM & Tool Calling** | **Groq Cloud API** (`llama-3.3-70b-versatile` / `llama-3.1-8b-instant`) | Natural-language request parsing + OpenAI-compatible function/tool calling |

---

## 2. Frontend Stack (React + Vite)

Placed in `desktop/src/` and built with Vite:

- **React + TypeScript (`react`, `react-dom`, `typescript`, `@vitejs/plugin-react`):**
  - Component-driven SPA split into 4 primary views: **Search Builder**, **Database & CSV Viewer**, **Groq AI Chat**, and **Settings / Logs**.
  - TypeScript interfaces shared across Tauri `invoke()` payloads (`JobRecord`, `JobProgress`, `CsvPreview`, `ToolExecutionEvent`, `ChatMessage`).
- **Vite (`vite`):**
  - Instant dev server (`http://localhost:1420`) integrated with `tauri dev`, and optimized production bundle (`dist/`) embedded into the Tauri binary on `tauri build`.
- **Tailwind CSS (`tailwindcss`, `@tailwindcss/vite`):**
  - Utility-first styling tailored for dense desktop tools (fixed sidebar, sticky table headers, status badges, split-pane chat + CSV preview).
- **UI Components (`shadcn/ui` on Radix UI + `lucide-react`):**
  - Accessible comboboxes (What/Where multi-select), popovers, dialogs (large-job confirmation, delete job confirmation), tabs, and toast notifications.
- **Virtualized Spreadsheet Grid (`@tanstack/react-table` + `@tanstack/react-virtual`):**
  - Handles wide Google Maps CSVs (36+ raw columns + socials + tech columns) and large result sets (`1,000–10,000+` rows) at 60 FPS by rendering only visible rows.
  - Supports column presets (`Name & Phone`, `8 Lead Fields`, `All Columns`), instant search, and per-column visibility toggles.
- **State Management (`zustand` + `@tanstack/react-query`):**
  - **Zustand:** Stores active CSV file path, column visibility, chat messages, and active tool-call stream state.
  - **TanStack Query:** Polls `get_job_status` every 2–3 seconds during active scrapes and refreshes `.engine/data/jobs.db` + CSV file lists automatically when jobs finish.
- **Tauri Frontend SDKs:**
  - `@tauri-apps/api` (`invoke`, `listen`)
  - `@tauri-apps/plugin-dialog` (native Save As CSV/JSON & Open CSV file picker)
  - `@tauri-apps/plugin-opener` (reveal CSV in Windows Explorer, open business website URL on explicit click)
  - `@tauri-apps/plugin-store` (non-sensitive UI preferences like selected model, theme, default depth, output directory)

---

## 3. Desktop Backend Stack (Rust in `desktop/src-tauri/`)

Why handle heavy lifting in Rust instead of React/JS?
1. **Direct access to `jobs.db` offline:** `rusqlite` reads `.engine/data/jobs.db` directly even if the Python engine isn't running.
2. **Fast CSV parsing & security:** Streaming 10k-row CSVs in Rust avoids freezing the WebView UI, and keeps file system boundaries strictly scoped.
3. **API key protection:** The Groq API key stays in Rust/Windows Credential Manager and is never exposed in browser `localStorage` or frontend requests.
4. **Strict tool-calling sandbox:** Groq calls typed Rust commands (`run_scrape_job`, `lookup_city`, `query_csv_preview`) — **never** arbitrary shell/PowerShell strings.

### Rust Crates (`Cargo.toml`)
- `tauri` (`v2`) — Desktop shell, window lifecycle (`RunEvent::Exit` stops managed Python engine cleanly), IPC commands, event emitter.
- `tauri-plugin-dialog` & `tauri-plugin-opener` & `tauri-plugin-store` — Native dialogs, Explorer/browser opener, lightweight settings persistence.
- `tokio` (`full`) — Async runtime for concurrent HTTP requests, engine log tailing, and non-blocking CSV reads.
- `reqwest` (`json`, `stream`, `rustls-tls`) — Pure-Rust TLS HTTP client for `https://api.groq.com/openai/v1/chat/completions`, `http://127.0.0.1:8080/api/v1/*`, and OpenStreetMap Nominatim.
- `rusqlite` (`bundled`) — Embeds SQLite directly in the Rust binary (zero external `sqlite3.dll` dependency on Windows) to query `.engine/data/jobs.db`.
- `csv` — Streaming CSV reader/writer with UTF-8 BOM (`\u{FEFF}`) support for Excel on Windows and `csv_safe` formula-injection escaping (`=`, `+`, `-`, `@`).
- `serde` & `serde_json` — JSON serialization for `jobs.db` `data`/`progress` blobs, Engine API payloads, and Groq tool schemas.
- `keyring` — Stores `GROQ_API_KEY` (and optional `SCRAPER_API_KEY`) securely in the OS credential vault (Windows Credential Manager).
- `thiserror` / `anyhow` — Structured error propagation from Rust/Engine/Groq into clear UI error banners.

### Python Engine Process Manager (Rust)
- Probes working Python binary in order: `python` -> `py` -> `python3` -> custom path from Settings (specifically solving Windows setups where `python` works while `py`/`python3` fail).
- Spawns `python engine/serve.py --port <SCRAPER_PORT>` with Windows `CREATE_NO_WINDOW` (`0x08000000`) so no black console window pops up.
- Polls `http://127.0.0.1:<port>/api/v1/jobs` and verifies the `X-Engine: gmskit-engine/*` header before marking the engine ready.
- Tails `.engine/engine.log` into the UI diagnostics drawer.

---

## 4. Existing Scraper & Browser Layer (Python)

Rather than rewriting the battle-tested Google Maps scraper in Rust, the Tauri app orchestrates the existing repository modules:

- **HTTP API & Worker:** `engine/serve.py`, `engine/jobs.py` (SQLite persistence, resume-on-restart, CSV streaming, `leads_csv`, `guard_csv`).
- **Headless Browser & CDP:** `engine/browser.py`, `engine/cdp.py`, `engine/maps.py`, `engine/details.py`.
  - Drives locally installed **Google Chrome** (or Edge/Brave/Chrome for Testing fallback).
  - Planned improvement (see PRD §6): make `Page.navigate` timeout configurable (`SCRAPER_NAV_TIMEOUT`, default `90 s` instead of hardcoded `45 s`) to eliminate `no Page.loadEventFired event within 45 s` failures on slower connections, and fix the raw regex `SyntaxWarning` in `engine/serve.py` line 637.
- **CLI Orchestration Features:** `scripts/scrape.py` capabilities (`--grid`, `--deep-scan`, `--tech`, `--verify-emails`, `--no-email`, `--no-socials`, `--has-phone`, `--fields`, `--exclude`) can either be invoked via structured Rust-validated flags on `scripts/scrape.py` or progressively exposed directly by the Rust orchestrator + local engine API.
- **Optional JS Website Rendering:** `requirements-browser.txt` (`playwright==1.60.0`) inside `.engine/playwright-venv` when `--browser-sites` is enabled.

---

## 5. AI & Tool-Calling Layer (Groq)

- **Endpoint:** `https://api.groq.com/openai/v1/chat/completions` (OpenAI-compatible `tools` & `tool_choice: "auto"`).
- **Recommended Models:**
  - **Primary:** `llama-3.3-70b-versatile` — reliable multi-parameter JSON tool calling for queries like *"coffee and dress shops in Navi Mumbai and Thane, phone only, name and phone"*.
  - **Fast / Lightweight:** `llama-3.1-8b-instant` — lower latency for simple status/listing queries.
  - **User-overridable:** Custom model ID field in Settings in case Groq releases newer tool-calling models.
- **Execution Architecture (Rust Agent Loop):**
  1. React sends user prompt + chat history -> Tauri `invoke("chat_with_groq")`.
  2. Rust attaches system instructions + JSON tool schemas (`get_engine_status`, `start_engine`, `lookup_city`, `run_scrape_job`, `get_job_status`, `list_jobs_and_csvs`, `query_csv_preview`, `export_filtered_csv`).
  3. Rust calls Groq with the locally stored `GROQ_API_KEY`.
  4. For every `tool_calls` response, Rust validates inputs, executes the typed function, emits a `chat://tool-event` to React (so the user sees live progress chips), and feeds bounded results back to Groq (max 25 sample rows wrapped as `<scraped_data_untrusted>`).
  5. Final assistant message + structured attachment (`{ csvPath, rowCount, columns }`) is emitted to React so the UI renders an inline **"Open CSV in Viewer"** button.

---

## 6. Proposed Package Manifests

### Frontend (`desktop/package.json` — Key Dependencies)
```json
{
  "name": "gmaps-scraper-desktop",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tanstack/react-query": "^5",
    "@tanstack/react-table": "^8",
    "@tanstack/react-virtual": "^3",
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-dialog": "^2",
    "@tauri-apps/plugin-opener": "^2",
    "@tauri-apps/plugin-store": "^2",
    "lucide-react": "^0.460",
    "react": "^19",
    "react-dom": "^19",
    "react-markdown": "^10",
    "remark-gfm": "^4",
    "zustand": "^5"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4",
    "@tauri-apps/cli": "^2",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^4",
    "tailwindcss": "^4",
    "typescript": "^5.7",
    "vitest": "^3",
    "@testing-library/react": "^16",
    "vite": "^6"
  }
}
```

### Rust Backend (`desktop/src-tauri/Cargo.toml` — Key Crates)
```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
tauri-plugin-opener = "2"
tauri-plugin-store = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", default-features = false, features = ["json", "stream", "rustls-tls"] }
rusqlite = { version = "0.32", features = ["bundled"] }
csv = "1.3"
keyring = "3"
thiserror = "2"
```

---

## 7. Verified Local Machine Toolchain & Build Notes

Verified directly on this machine (`c:\kali\product\scraper`):

| Tool | Observed Status | Windows Note |
|---|---|---|
| **Node.js** | `v26.4.0` (Installed) | Ready for Vite + React + Tauri CLI |
| **npm** | `11.17.0` via `npm.cmd` | PowerShell blocks `npm.ps1` via ExecutionPolicy; use `npm.cmd` in PowerShell or `npm` in `cmd` |
| **Rust / Cargo** | `rustc 1.97.1` / `cargo 1.97.1` (Installed) | Ready for `src-tauri` builds |
| **Python** | `Python 3.14.6` via `python` | Use `python` (not `py` or `python3`, which failed on this machine) |
| **Browser** | `C:\Program Files\Google\Chrome\Application\chrome.exe` (`Chrome/157.0.8103.39`) | Detected automatically by `engine/browser.py` |
| **Windows Tauri Build Deps** | WebView2 + MSVC C++ Build Tools | Ensure Visual Studio C++ Build Tools (`Desktop development with C++`) and Edge WebView2 Runtime are present when running `cargo` / `tauri build` |

---

## 8. Testing & Quality Assurance Stack

- **Frontend Unit & Component Tests:** `Vitest` + `@testing-library/react` + `tsc --noEmit` (table filtering, column presets, chat message rendering, Tauri mock IPC).
- **Rust Backend Tests:** `cargo test` + `cargo clippy` (SQLite `jobs.db` reading, `csv` filtering & `csv_safe` formula escaping, Groq tool-argument validation, prompt-injection truncation limits).
- **Python Engine Tests:** Existing offline test suites (`python scripts/test_scrape.py`, `python engine/test_engine.py`, `python engine/test_cdp.py`, `python engine/test_website_browser.py`).
- **Packaging & Distribution:** `npm.cmd run tauri build` generates Windows `.msi` / NSIS `.exe` installers under `desktop/src-tauri/target/release/bundle/`.

