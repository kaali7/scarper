# Project Task Tracker: Google Maps Scraper Kit — Tauri App (`my_app`)

- **Document Path:** `c:\kali\product\scraper\my_docs\task.md`
- **Target App Folder:** `c:\kali\product\scraper\my_app` *(Tauri v2 + React + Vite workspace)*
- **Reference Docs:** [prd.md](prd.md) | [tech-stack.md](tech-stack.md)
- **Last Updated:** 2026-11-11

---

## Completed Tasks

- [x] **Workspace Cleanup:** Moved all inner files and folders out of `google-maps-scraper-kit/` into `c:\kali\product\scraper`.
- [x] **Environment Verification:** Verified local tools on Windows:
  - Python `3.14.6` via `python` (`py` and `python3` unavailable)
  - Google Chrome `157.0.8103.39` at `C:\Program Files\Google\Chrome\Application\chrome.exe`
  - Node.js `v26.4.0` and `npm` `11.17.0` (via `npm.cmd` in PowerShell / `npm` in `cmd`)
  - Rust `rustc 1.97.1` and `cargo 1.97.1`
- [x] **Live Scraper Test & Error Diagnosis:**
  - Inspected `.engine/engine.log` and `.engine/data/jobs.db`, identifying the root cause of failed runs (`no Page.loadEventFired event within 45 s` in `engine/cdp.py`).
  - Executed a live scrape (`coffee shops` and `dress shops` in `Navi Mumbai, India` and `Thane, India`, phone-only, `title,phone`) producing `navi-mumbai-thane-leads.csv` (177 businesses).
- [x] **Documentation Created in `my_docs/`:**
  - [x] `my_docs/prd.md` — Product Requirements Document (Search Builder, `jobs.db` & CSV Viewer, Groq AI Chat with tool calling).
  - [x] `my_docs/tech-stack.md` — Full Tauri v2 + React + Vite + Rust + Groq tech stack specification.
  - [x] `my_docs/task.md` — Master task checklist (this file).
- [x] **Phase 0: Python Engine Reliability Fixes (`engine/`):**
  - [x] **Configurable Navigation Timeout (`engine/cdp.py`, `engine/jobs.py`, `engine/serve.py`, `.env.example`):** Added `nav_timeout()` (`SCRAPER_NAV_TIMEOUT`, default `90` s, min `5`), updated `Page.navigate` default timeout from `45` s to `nav_timeout()`, and updated `WATCHDOG_GRACE = max(90, nav_timeout() + 45)` (`135` s default).
  - [x] **Fix Python 3.14 `SyntaxWarning` (`engine/serve.py` line 637):** Properly escaped `\\d` and `\\.` in the embedded JS regex; verified zero warnings with `python -W error::SyntaxWarning`.
  - [x] **Verified Python Test Suites:** `engine/test_cdp.py` (27/27 OK), `engine/test_engine.py` (102 tests, OK with 5 platform/optional skips), `scripts/test_scrape.py` (113/113 OK).
- [x] **Phase 1: Scaffold Tauri v2 + React + Vite App (`c:\kali\product\scraper\my_app`):**
  - [x] **Frontend Scaffold (`my_app/`):** Created `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`, `src/index.css` (Tailwind CSS v4), `src/main.tsx`, `src/App.tsx`, and `.gitignore`; installed 194 npm packages (`react`, `react-dom`, `lucide-react`, `@tanstack/react-table`, `@tanstack/react-virtual`, `@tanstack/react-query`, `zustand`, `react-markdown`, `remark-gfm`, `@tauri-apps/api`, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-opener`, `@tauri-apps/plugin-store`).
  - [x] **Tauri v2 Rust Scaffold (`my_app/src-tauri/`):** Created `Cargo.toml`, `build.rs`, `tauri.conf.json`, `capabilities/default.json`, `src/main.rs`, `src/lib.rs`, and valid PNG/ICO icons in `icons/`; locked and compiled 515 Rust crates (`tauri`, `tauri-plugin-dialog`, `tauri-plugin-opener`, `tauri-plugin-store`, `tokio`, `reqwest`, `rusqlite` bundled, `csv`, `serde`, `serde_json`, `keyring`, `thiserror`).
  - [x] **Build Smoke Check:** `npm.cmd run build` (`tsc && vite build`, built in 2.12 s) and `cargo check` (exit 0) both succeeded cleanly.
- [x] **Phase 2: Rust Backend Core (`my_app/src-tauri/src/`):**
  - [x] **`error.rs` & `config.rs`:** Kit root auto-detection, `.env` parsing/updating (`SCRAPER_PORT`, `SCRAPER_API_KEY`, `SCRAPER_HEADLESS`, `SCRAPER_NAV_TIMEOUT`), and Windows Credential Manager (`keyring` `windows-native`) secret storage for `GROQ_API_KEY` + connection test (`test_groq_connection`).
  - [x] **`engine_proc.rs`:** Windows-aware Python probing (`python` -> `py` -> `python3` -> custom override, ignoring Windows Store launcher missing message), Chrome detection via `engine/browser.py`, silent `engine/serve.py` spawning (`CREATE_NO_WINDOW`), `X-Engine` header health checks, `.engine/engine.log` tailing, and clean shutdown on `RunEvent::Exit`.
  - [x] **`db.rs`:** Direct read-only `rusqlite` queries on `.engine/data/jobs.db` + `delete_db_job` (API when running, SQLite/CSV cleanup when stopped).
  - [x] **`csv_io.rs`:** Workspace + `.engine/data/*.csv` scanner, UTF-8/BOM CSV parser with filters (`has_phone`, `has_email`, `no_website`, `min_rating`, search, column projection), and formula-safe CSV/JSON exporter (`csv_safe` parity).
  - [x] **`scraper_api.rs`:** Preset loader (`business-types.json`), city lookup (`/api/v1/cities` + OpenStreetMap Nominatim), job polling + `scrape://progress` event emitter, multi-city deduped export, and structured `scripts/scrape.py` fallback for `--grid`/`--deep-scan`/`--tech`/`--browser-sites`.
  - [x] **`groq_agent.rs` & `lib.rs`:** Groq Chat Completions tool-calling loop with 8 typed tools, `<scraped_data_untrusted>` isolation (`<= 25` rows, `<= 200` char cells), large-job rate-limit guardrail, `chat://tool-event` streaming, and all 21 Tauri IPC commands registered.
  - [x] **Verified Rust Unit Tests:** `cargo test` passed all **8/8** unit tests in 0.02 s with zero compiler warnings.
- [x] **Phase 3: React + Vite Frontend UI (`my_app/src/`):**
  - [x] **Types, API & State (`src/types.ts`, `src/api.ts`, `src/store.ts`):** Typed wrappers for all 21 Tauri IPC commands + Zustand store for active tabs, CSV viewer navigation, live progress, and Groq chat stream.
  - [x] **App Shell & Top Status Bar (`src/App.tsx`, `src/components/TopBar.tsx`):** Auto-starts local Python engine on launch, monitors port/Python/Chrome status, provides Start/Restart/Stop buttons, and listens for `scrape://progress` and `chat://tool-event`.
  - [x] **Search Builder View (`src/components/SearchBuilder.tsx`):** Quick presets (`Name & Phone Only`, `Full Outreach`, `No Website Leads`, `Custom`), custom + `business-types.json` keyword tags, multi-city autocomplete (`/api/v1/cities` + Nominatim lat/lon preview), column selector (`title, phone`), advanced options (`depth`, `country`, `lang`, `grid`, `deep_scan`, `proxies`), large-job guardrail confirmation, live progress bars, and one-click **Open CSV in Viewer**.
  - [x] **Database (`jobs.db`) & Click-to-Open CSV Viewer (`src/components/DbCsvExplorer.tsx`):** Lists `.engine/data/jobs.db` jobs (status badges, counts, errors, delete action) + saved root `*.csv` files + external CSV picker; clicking any entry renders a virtualized TanStack Table (`@tanstack/react-table` + `@tanstack/react-virtual`) with sorting, search, `Has Phone` / `Has Email` / `No Website` filters, column toggles (`Name & Phone`, `8 Lead Fields`, `All`), one-click cell copy, Explorer reveal, and CSV/JSON export.
  - [x] **AI Chat View (`src/components/AiChat.tsx`):** Multi-turn Groq chat with starter prompts, markdown/table rendering (`react-markdown` + `remark-gfm`), collapsible tool-execution traces, live `chat://tool-event` stream, and clickable **"Open CSV in Viewer"** artifact buttons.
  - [x] **Settings & Logs View (`src/components/SettingsLogs.tsx`):** Masked Groq API key management (`set_groq_api_key`, `clear_groq_api_key`, `test_groq_connection`), Groq model selector, kit root/Python override, `.env` controls (`SCRAPER_PORT`, `SCRAPER_NAV_TIMEOUT`, `SCRAPER_HEADLESS`), and `.engine/engine.log` viewer.
  - [x] **Verified Frontend Build:** `npm.cmd run build` (`tsc && vite build`) succeeded in 6.85 s; `cargo test` passed 8/8 tests.
- [x] **Phase 4 (Automated): Tests, Desktop Binary & Engine Smoke Verification:**
  - [x] **Frontend Component Tests (`my_app/src/__tests__/app.test.tsx`):** Added `vitest.config.ts` & `setup.ts`; `npm.cmd test` passed **3/3** component tests (mocked Tauri IPC covering `SearchBuilder`, `DbCsvExplorer`, and `AiChat`).
  - [x] **Frontend Production Build:** `npm.cmd run build` (`tsc && vite build`) succeeded in 2.56 s.
  - [x] **Rust Unit Tests & Desktop Binary:** Added multi-city dedupe & JSON export test in `csv_io.rs`; `cargo test` passed **9/9** unit tests and `cargo build` linked `gmaps-scraper-desktop.exe` cleanly.
  - [x] **Local Engine API Smoke Check:** Verified `scripts/engine.py start` → `GET /api/v1/cities?q=Thane` (`200`, `X-Engine: gmskit-engine/2.3.0`, GeoNames `Thāne, Maharashtra, IN` at `19.197, 72.9636`) → `scripts/engine.py stop` with zero `SyntaxWarning`s in `.engine/engine.log`.

---

## Pending Tasks (Interactive User Verification in `tauri dev`)

- [ ] **Interactive Desktop Window Walkthrough (`npm run tauri dev` in `cmd`, or `npm.cmd run tauri dev` in PowerShell):**
  - Confirm app window opens and auto-starts the engine without manual `cmd` commands.
  - Confirm clicking `jobs.db` entries and `navi-mumbai-thane-leads.csv` renders the virtualized CSV table inside the app.
  - Confirm Search Builder runs a phone-only search (`title,phone`) cleanly.
  - Enter your Groq API key in **Settings & Logs**, test connection, and confirm **AI Chat (Groq)** runs a natural-language prompt and opens the resulting CSV in the viewer.

