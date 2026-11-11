use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use crate::config::{load_config, read_kit_env, resolve_kit_root};
use crate::csv_io::{sanitize_output_filename, write_filtered_export, CsvFilterOptions};
use crate::db::job_csv_path;
use crate::engine_proc::{detect_python, start_internal, status_internal};
use crate::error::AppResult;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CityMatch {
    pub label: String,
    pub lat: String,
    pub lon: String,
    pub country: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CityInput {
    pub label: String,
    pub lat: Option<String>,
    pub lon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrapeRequest {
    pub keywords: Vec<String>,
    pub cities: Vec<CityInput>,
    pub depth: Option<u32>,
    pub zoom: Option<u32>,
    pub lang: Option<String>,
    pub country: Option<String>,
    pub max_time: Option<u64>,
    pub collect_emails: Option<bool>,
    pub collect_socials: Option<bool>,
    pub verify_emails: Option<bool>,
    pub browser_sites: Option<bool>,
    pub reviews_max: Option<u32>,
    pub proxies: Option<Vec<String>>,
    pub has_phone: Option<bool>,
    pub has_email: Option<bool>,
    pub no_website: Option<bool>,
    pub min_rating: Option<f64>,
    pub fields: Option<Vec<String>>,
    pub out_filename: Option<String>,
    pub grid: Option<u32>,
    pub deep_scan: Option<bool>,
    pub tech: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrapeRunResult {
    pub job_ids: Vec<String>,
    pub primary_csv_path: Option<String>,
    pub exported_csv_path: Option<String>,
    pub exported_rows: usize,
    pub total_places: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveJobProgressEvent {
    pub job_id: String,
    pub city_label: String,
    pub status: String,
    pub stage: String,
    pub keywords_done: i64,
    pub keywords_total: i64,
    pub places: i64,
    pub percent: i64,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineJobStatus {
    pub id: String,
    pub name: String,
    pub status: String,
    pub error: String,
    pub places: i64,
    pub percent: i64,
    pub stage: String,
    pub keywords_done: i64,
    pub keywords_total: i64,
}

fn engine_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .no_proxy()
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

pub fn load_business_types_from_disk(kit_root: &Path) -> AppResult<Vec<String>> {
    let p = kit_root
        .join("engine")
        .join("presets")
        .join("business-types.json");
    if !p.is_file() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&p).map_err(|e| format!("Failed to read business-types.json: {e}"))?;
    let list: Vec<String> = serde_json::from_str(&raw).unwrap_or_default();
    Ok(list)
}

#[tauri::command]
pub fn list_business_types(app: AppHandle) -> AppResult<Vec<String>> {
    let kit_root = resolve_kit_root(&app)?;
    load_business_types_from_disk(&kit_root)
}

pub async fn lookup_city_internal(app: &AppHandle, query: &str) -> AppResult<Vec<CityMatch>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let kit_root = resolve_kit_root(app)?;
    let env = read_kit_env(&kit_root);
    let mut results = Vec::new();

    // 1. Try local engine /api/v1/cities (GeoNames dataset) when engine is running.
    if let Ok(client) = engine_client() {
        let mut req = client
            .get(format!("http://127.0.0.1:{}/api/v1/cities", env.port))
            .query(&[("q", q)]);
        if !env.api_key.is_empty() {
            req = req.header("X-API-Key", &env.api_key);
        }
        if let Ok(resp) = req.send().await {
            if resp.status().is_success() {
                if let Ok(arr) = resp.json::<Vec<serde_json::Value>>().await {
                    for item in arr.into_iter().take(8) {
                        if let (Some(label), Some(lat), Some(lon)) = (
                            item["label"].as_str(),
                            item["lat"].as_str(),
                            item["lon"].as_str(),
                        ) {
                            results.push(CityMatch {
                                label: label.to_string(),
                                lat: lat.to_string(),
                                lon: lon.to_string(),
                                country: item["country"].as_str().unwrap_or("").to_string(),
                                source: "geonames".to_string(),
                            });
                        }
                    }
                }
            }
        }
    }

    // 2. Fallback / supplement via OpenStreetMap Nominatim when GeoNames has no exact hit (e.g. "Navi Mumbai, India").
    if results.is_empty() {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| format!("HTTP client error: {e}"))?;
        let resp = client
            .get("https://nominatim.openstreetmap.org/search")
            .header(
                "User-Agent",
                "google-maps-scraper-kit/2.3 (desktop-tauri-client)",
            )
            .query(&[
                ("format", "json"),
                ("limit", "5"),
                ("addressdetails", "1"),
                ("q", q),
            ])
            .send()
            .await
            .map_err(|e| format!("City geocoding failed: {e}"))?;

        if resp.status().is_success() {
            if let Ok(hits) = resp.json::<Vec<serde_json::Value>>().await {
                for hit in hits {
                    if let (Some(lat), Some(lon)) = (hit["lat"].as_str(), hit["lon"].as_str()) {
                        let label = hit["display_name"]
                            .as_str()
                            .unwrap_or(q)
                            .to_string();
                        let cc = hit["address"]["country_code"]
                            .as_str()
                            .unwrap_or("")
                            .to_ascii_lowercase();
                        results.push(CityMatch {
                            label,
                            lat: lat.to_string(),
                            lon: lon.to_string(),
                            country: cc,
                            source: "nominatim".to_string(),
                        });
                    }
                }
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn lookup_city(app: AppHandle, query: String) -> AppResult<Vec<CityMatch>> {
    lookup_city_internal(&app, &query).await
}

pub async fn fetch_job_status_internal(
    port: u16,
    api_key: &str,
    job_id: &str,
) -> AppResult<EngineJobStatus> {
    let client = engine_client()?;
    let mut req = client.get(format!("http://127.0.0.1:{port}/api/v1/jobs/{job_id}"));
    if !api_key.is_empty() {
        req = req.header("X-API-Key", api_key);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("Failed to reach engine: {e}"))?;
    if !resp.status().is_success() {
        let code = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Engine returned HTTP {code}: {body}"));
    }
    let v: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Invalid job status JSON: {e}"))?;
    Ok(EngineJobStatus {
        id: v["ID"].as_str().unwrap_or(job_id).to_string(),
        name: v["Name"].as_str().unwrap_or("").to_string(),
        status: v["Status"].as_str().unwrap_or("unknown").to_string(),
        error: v["Error"].as_str().unwrap_or("").to_string(),
        places: v["Progress"]["places"].as_i64().unwrap_or(0),
        percent: v["Progress"]["percent"].as_i64().unwrap_or(0),
        stage: v["Progress"]["stage"].as_str().unwrap_or("").to_string(),
        keywords_done: v["Progress"]["keywords_done"].as_i64().unwrap_or(0),
        keywords_total: v["Progress"]["keywords_total"].as_i64().unwrap_or(0),
    })
}

#[tauri::command]
pub async fn get_job_status(app: AppHandle, job_id: String) -> AppResult<EngineJobStatus> {
    let kit_root = resolve_kit_root(&app)?;
    let env = read_kit_env(&kit_root);
    fetch_job_status_internal(env.port, &env.api_key, &job_id).await
}

fn validate_scrape_request(req: &ScrapeRequest) -> AppResult<Vec<String>> {
    let keywords: Vec<String> = req
        .keywords
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if keywords.is_empty() {
        return Err("At least one keyword is required.".to_string());
    }
    if keywords.len() > 500 {
        return Err("At most 500 keywords per job.".to_string());
    }
    let lang = req.lang.as_deref().unwrap_or("en").trim();
    if lang.len() != 2 || !lang.chars().all(|c| c.is_ascii_alphabetic()) {
        return Err("Language must be a 2-letter code (e.g. 'en').".to_string());
    }
    if let Some(ref cc) = req.country {
        let trimmed = cc.trim();
        if !trimmed.is_empty() && (trimmed.len() != 2 || !trimmed.chars().all(|c| c.is_ascii_alphabetic())) {
            return Err("Country must be a 2-letter code (e.g. 'in', 'us').".to_string());
        }
    }
    if let Some(grid) = req.grid {
        if !(1..=10).contains(&grid) {
            return Err("Grid size must be between 1 and 10.".to_string());
        }
    }
    Ok(keywords)
}

async fn run_via_scrape_cli(
    app: &AppHandle,
    kit_root: &Path,
    req: &ScrapeRequest,
    keywords: &[String],
) -> AppResult<ScrapeRunResult> {
    let cfg = load_config(app);
    let py = detect_python(cfg.python_override.as_deref())
        .ok_or_else(|| "Python 3.9+ not found for CLI scrape.".to_string())?;

    let out_name = sanitize_output_filename(
        req.out_filename
            .as_deref()
            .unwrap_or("results-desktop.csv"),
        "csv",
    )?;
    let out_path = kit_root.join(&out_name);

    let mut args = vec![
        "scripts/scrape.py".to_string(),
        keywords[0].clone(),
    ];
    for extra_kw in &keywords[1..] {
        args.push("--keyword".to_string());
        args.push(extra_kw.clone());
    }
    for c in &req.cities {
        let lbl = c.label.trim();
        if !lbl.is_empty() {
            args.push("--city".to_string());
            args.push(lbl.to_string());
        }
    }
    args.push("--depth".to_string());
    args.push(req.depth.unwrap_or(5).to_string());
    args.push("--lang".to_string());
    args.push(req.lang.as_deref().unwrap_or("en").to_lowercase());
    if let Some(ref cc) = req.country {
        if !cc.trim().is_empty() {
            args.push("--country".to_string());
            args.push(cc.trim().to_lowercase());
        }
    }
    args.push("--max-time".to_string());
    args.push(req.max_time.unwrap_or(600).to_string());

    if !req.collect_emails.unwrap_or(true) {
        args.push("--no-email".to_string());
    }
    if !req.collect_socials.unwrap_or(true) {
        args.push("--no-socials".to_string());
    }
    if req.verify_emails.unwrap_or(false) {
        args.push("--verify-emails".to_string());
    }
    if req.browser_sites.unwrap_or(false) {
        args.push("--browser-sites".to_string());
    }
    if req.tech.unwrap_or(false) {
        args.push("--tech".to_string());
    }
    if let Some(g) = req.grid {
        args.push("--grid".to_string());
        args.push(g.to_string());
    }
    if req.deep_scan.unwrap_or(false) {
        args.push("--deep-scan".to_string());
    }
    if req.has_phone.unwrap_or(false) {
        args.push("--has-phone".to_string());
    }
    if req.has_email.unwrap_or(false) {
        args.push("--has-email".to_string());
    }
    if req.no_website.unwrap_or(false) {
        args.push("--no-website".to_string());
    }
    if let Some(min_r) = req.min_rating {
        args.push("--min-rating".to_string());
        args.push(min_r.to_string());
    }
    if let Some(ref fields) = req.fields {
        if !fields.is_empty() {
            args.push("--fields".to_string());
            args.push(fields.join(","));
        }
    }
    if let Some(rev) = req.reviews_max {
        if rev > 0 {
            args.push("--reviews".to_string());
            args.push(rev.min(5).to_string());
        }
    }
    for p in req.proxies.as_deref().unwrap_or(&[]) {
        if !p.trim().is_empty() {
            args.push("--proxy".to_string());
            args.push(p.trim().to_string());
        }
    }
    args.push("--out".to_string());
    args.push(out_path.to_string_lossy().to_string());

    let kit_owned = kit_root.to_path_buf();
    let py_bin = py.executable;
    let output = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&py_bin);
        cmd.args(&args)
            .current_dir(&kit_owned)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.output()
    })
    .await
    .map_err(|e| format!("CLI join error: {e}"))?
    .map_err(|e| format!("Failed to run scripts/scrape.py: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let mut warnings = Vec::new();
    for line in stdout.lines().chain(stderr.lines()) {
        if line.contains('⚠') || line.contains('✗') {
            warnings.push(line.trim().to_string());
        }
    }

    if !out_path.is_file() && !output.status.success() {
        return Err(format!("Scrape failed:\n{stdout}\n{stderr}"));
    }

    let exported_rows = crate::csv_io::load_csv_table(
        &out_path,
        &CsvFilterOptions {
            max_rows: Some(1),
            ..Default::default()
        },
    )
    .map(|t| t.total_rows)
    .unwrap_or(0);

    Ok(ScrapeRunResult {
        job_ids: Vec::new(),
        primary_csv_path: Some(out_path.to_string_lossy().to_string()),
        exported_csv_path: Some(out_path.to_string_lossy().to_string()),
        exported_rows,
        total_places: exported_rows,
        warnings,
    })
}

pub async fn run_scrape_and_export(
    app: &AppHandle,
    req: ScrapeRequest,
    wait_for_completion: bool,
) -> AppResult<ScrapeRunResult> {
    let keywords = validate_scrape_request(&req)?;
    let kit_root = resolve_kit_root(app)?;

    let status = status_internal(app).await?;
    if !status.running {
        start_internal(app).await?;
    }

    // Use structured scripts/scrape.py runner when CLI-only modes (grid/deep_scan/tech/browser_sites) are requested.
    if req.grid.is_some()
        || req.deep_scan.unwrap_or(false)
        || req.tech.unwrap_or(false)
        || req.browser_sites.unwrap_or(false)
    {
        return run_via_scrape_cli(app, &kit_root, &req, &keywords).await;
    }

    let env = read_kit_env(&kit_root);
    let client = engine_client()?;

    // Resolve coordinates for any city missing lat/lon.
    let mut targets: Vec<(String, Option<String>, Option<String>)> = Vec::new();
    if req.cities.is_empty() {
        targets.push((String::new(), None, None));
    } else {
        for c in &req.cities {
            let label = c.label.trim().to_string();
            if let (Some(lat), Some(lon)) = (&c.lat, &c.lon) {
                if !lat.trim().is_empty() && !lon.trim().is_empty() {
                    targets.push((label, Some(lat.trim().to_string()), Some(lon.trim().to_string())));
                    continue;
                }
            }
            if !label.is_empty() {
                let hits = lookup_city_internal(app, &label).await?;
                if let Some(first) = hits.first() {
                    targets.push((label, Some(first.lat.clone()), Some(first.lon.clone())));
                } else {
                    targets.push((label, None, None));
                }
            }
        }
    }

    let depth = req.depth.unwrap_or(5);
    let zoom = req.zoom.unwrap_or(15);
    let lang = req.lang.as_deref().unwrap_or("en").trim().to_lowercase();
    let country = req
        .country
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_lowercase);
    let max_time = req.max_time.unwrap_or(600);
    let email = req.collect_emails.unwrap_or(true);
    let socials = req.collect_socials.unwrap_or(true);
    let verify_emails = req.verify_emails.unwrap_or(false);
    let reviews_max = req.reviews_max.unwrap_or(0).min(5);
    let proxies = req.proxies.clone().unwrap_or_default();

    let mut job_ids = Vec::new();
    let mut warnings = Vec::new();

    for (city_label, lat, lon) in &targets {
        let name = if city_label.is_empty() {
            keywords[0].clone()
        } else {
            format!("{} @ {}", keywords[0], city_label)
        };
        let name_trunc: String = name.chars().take(180).collect();

        let mut body = serde_json::json!({
            "name": name_trunc,
            "keywords": keywords,
            "lang": lang,
            "zoom": zoom,
            "depth": depth,
            "max_time": max_time,
            "email": email,
            "socials": socials,
            "verify_emails": verify_emails,
            "reviews_max": reviews_max,
        });
        if let Some(ref cc) = country {
            body["country"] = serde_json::Value::String(cc.clone());
        }
        if let (Some(la), Some(lo)) = (lat, lon) {
            body["lat"] = serde_json::Value::String(la.clone());
            body["lon"] = serde_json::Value::String(lo.clone());
        }
        if !proxies.is_empty() {
            body["proxies"] = serde_json::json!(proxies);
        }

        let mut post = client
            .post(format!("http://127.0.0.1:{}/api/v1/jobs", env.port))
            .json(&body);
        if !env.api_key.is_empty() {
            post = post.header("X-API-Key", &env.api_key);
        }
        let resp = post
            .send()
            .await
            .map_err(|e| format!("Failed to create job: {e}"))?;
        if !resp.status().is_success() {
            let code = resp.status();
            let err_text = resp.text().await.unwrap_or_default();
            return Err(format!("Engine rejected job (HTTP {code}): {err_text}"));
        }
        let created: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Invalid create-job response: {e}"))?;
        let jid = created["id"]
            .as_str()
            .ok_or_else(|| "Engine response missing job id.".to_string())?
            .to_string();
        job_ids.push(jid);
    }

    if !wait_for_completion {
        let first_csv = job_ids
            .first()
            .map(|id| job_csv_path(&kit_root, id).to_string_lossy().to_string());
        return Ok(ScrapeRunResult {
            job_ids,
            primary_csv_path: first_csv,
            exported_csv_path: None,
            exported_rows: 0,
            total_places: 0,
            warnings,
        });
    }

    // Poll each job until ok/failed, emitting live progress events.
    let mut csv_sources: Vec<PathBuf> = Vec::new();
    let mut total_places = 0usize;
    let total_deadline = Instant::now() + Duration::from_secs(max_time * (targets.len().max(1) as u64) + 180);

    for (idx, jid) in job_ids.iter().enumerate() {
        let city_label = targets
            .get(idx)
            .map(|t| t.0.clone())
            .unwrap_or_default();
        loop {
            let st = fetch_job_status_internal(env.port, &env.api_key, jid).await?;
            let _ = app.emit(
                "scrape://progress",
                LiveJobProgressEvent {
                    job_id: jid.clone(),
                    city_label: city_label.clone(),
                    status: st.status.clone(),
                    stage: st.stage.clone(),
                    keywords_done: st.keywords_done,
                    keywords_total: st.keywords_total,
                    places: st.places,
                    percent: st.percent,
                    error: st.error.clone(),
                },
            );
            if st.status == "ok" || st.status == "failed" {
                total_places += st.places.max(0) as usize;
                if !st.error.is_empty() {
                    warnings.push(format!("{city_label}: {}", st.error));
                }
                let p = job_csv_path(&kit_root, jid);
                if p.is_file() {
                    csv_sources.push(p);
                }
                break;
            }
            if Instant::now() >= total_deadline {
                return Err("Timed out waiting for scrape job(s) to finish.".to_string());
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }

    let primary_csv_path = csv_sources
        .first()
        .map(|p| p.to_string_lossy().to_string());

    let needs_post_export = req.out_filename.is_some()
        || req.has_phone.unwrap_or(false)
        || req.has_email.unwrap_or(false)
        || req.no_website.unwrap_or(false)
        || req.min_rating.is_some()
        || req.fields.as_ref().map(|f| !f.is_empty()).unwrap_or(false)
        || csv_sources.len() > 1;

    if needs_post_export && !csv_sources.is_empty() {
        let default_name = format!(
            "results-{}.csv",
            job_ids
                .first()
                .map(|s| s.chars().take(8).collect::<String>())
                .unwrap_or_else(|| "export".to_string())
        );
        let safe_name = sanitize_output_filename(
            req.out_filename.as_deref().unwrap_or(&default_name),
            "csv",
        )?;
        let out_path = kit_root.join(safe_name);
        let filter_opts = CsvFilterOptions {
            search: None,
            has_phone: req.has_phone.unwrap_or(false),
            has_email: req.has_email.unwrap_or(false),
            no_website: req.no_website.unwrap_or(false),
            min_rating: req.min_rating,
            columns: req.fields.clone(),
            max_rows: None,
        };
        let as_json = out_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("json"))
            .unwrap_or(false);
        let exported_rows = write_filtered_export(&csv_sources, &out_path, &filter_opts, as_json)?;
        return Ok(ScrapeRunResult {
            job_ids,
            primary_csv_path,
            exported_csv_path: Some(out_path.to_string_lossy().to_string()),
            exported_rows,
            total_places,
            warnings,
        });
    }

    Ok(ScrapeRunResult {
        job_ids,
        primary_csv_path: primary_csv_path.clone(),
        exported_csv_path: primary_csv_path,
        exported_rows: total_places,
        total_places,
        warnings,
    })
}

#[tauri::command]
pub async fn start_scrape_job(
    app: AppHandle,
    request: ScrapeRequest,
    wait_for_completion: Option<bool>,
) -> AppResult<ScrapeRunResult> {
    run_scrape_and_export(&app, request, wait_for_completion.unwrap_or(false)).await
}

