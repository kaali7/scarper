use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::AppHandle;

use crate::config::resolve_kit_root;
use crate::db::read_jobs_from_db;
use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvFileEntry {
    pub name: String,
    pub path: String,
    pub source: String, // "workspace" | "engine_job"
    pub size_bytes: u64,
    pub modified_ms: u64,
    pub row_count: usize,
    pub job_id: Option<String>,
    pub job_status: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CsvFilterOptions {
    pub search: Option<String>,
    pub has_phone: bool,
    pub has_email: bool,
    pub no_website: bool,
    pub min_rating: Option<f64>,
    pub columns: Option<Vec<String>>,
    pub max_rows: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvTableData {
    pub path: String,
    pub headers: Vec<String>,
    pub all_headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub total_rows: usize,
    pub filtered_rows: usize,
}

pub fn is_formula_cell(s: &str) -> bool {
    let mut chars = s.chars();
    while chars.as_str().starts_with('\'') {
        chars.next();
    }
    let rest = chars.as_str();
    let Some(first) = rest.chars().next() else {
        return false;
    };
    if matches!(first, '=' | '@' | '\t' | '\r') {
        return true;
    }
    if first == '+' || first == '-' {
        // Match jobs.py / scrape.py: allow phone numbers like "+1 512-555-0100" or "+91 98... ext. 12".
        let after = &rest[1..];
        let trimmed = after.trim();
        let phone_body = if let Some(idx) = trimmed.to_ascii_lowercase().find("ext") {
            trimmed[..idx].trim()
        } else {
            trimmed
        };
        let is_phone = phone_body
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, ' ' | '(' | ')' | '.' | '-'));
        return !is_phone;
    }
    false
}

pub fn csv_safe(val: &str) -> String {
    if is_formula_cell(val) {
        format!("'{val}")
    } else {
        val.to_string()
    }
}

pub fn display_unguard(val: &str) -> &str {
    if let Some(stripped) = val.strip_prefix('\'') {
        if is_formula_cell(stripped) {
            return stripped;
        }
    }
    val
}

fn count_csv_data_rows(path: &Path) -> usize {
    let Ok(file) = File::open(path) else {
        return 0;
    };
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .from_reader(BufReader::new(file));
    reader.records().count()
}

pub fn scan_csv_files(kit_root: &Path) -> AppResult<Vec<CsvFileEntry>> {
    let mut entries = Vec::new();
    let jobs_map: HashMap<String, (String, String)> = read_jobs_from_db(kit_root)
        .unwrap_or_default()
        .into_iter()
        .map(|j| (j.id, (j.name, j.status)))
        .collect();

    if let Ok(rd) = fs::read_dir(kit_root) {
        for item in rd.flatten() {
            let p = item.path();
            if p.is_file()
                && p.extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.eq_ignore_ascii_case("csv"))
                    .unwrap_or(false)
            {
                if let Ok(meta) = item.metadata() {
                    let modified_ms = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);
                    entries.push(CsvFileEntry {
                        name: item.file_name().to_string_lossy().to_string(),
                        path: p.to_string_lossy().to_string(),
                        source: "workspace".to_string(),
                        size_bytes: meta.len(),
                        modified_ms,
                        row_count: count_csv_data_rows(&p),
                        job_id: None,
                        job_status: None,
                    });
                }
            }
        }
    }

    let engine_data = kit_root.join(".engine").join("data");
    if let Ok(rd) = fs::read_dir(&engine_data) {
        for item in rd.flatten() {
            let p = item.path();
            if p.is_file()
                && p.extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.eq_ignore_ascii_case("csv"))
                    .unwrap_or(false)
            {
                if let Ok(meta) = item.metadata() {
                    let stem = p
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_string();
                    let (job_name, job_status) = jobs_map
                        .get(&stem)
                        .map(|(n, st)| (Some(n.clone()), Some(st.clone())))
                        .unwrap_or((None, None));
                    let modified_ms = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);
                    let display_name = job_name
                        .map(|n| format!("{n} ({}.csv)", &stem.chars().take(8).collect::<String>()))
                        .unwrap_or_else(|| item.file_name().to_string_lossy().to_string());
                    entries.push(CsvFileEntry {
                        name: display_name,
                        path: p.to_string_lossy().to_string(),
                        source: "engine_job".to_string(),
                        size_bytes: meta.len(),
                        modified_ms,
                        row_count: count_csv_data_rows(&p),
                        job_id: Some(stem),
                        job_status,
                    });
                }
            }
        }
    }

    entries.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(entries)
}

fn read_utf8_stripping_bom(path: &Path) -> AppResult<Vec<u8>> {
    let mut file = File::open(path).map_err(|e| format!("Failed to open {}: {e}", path.display()))?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)
        .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    if buf.starts_with(&[0xEF, 0xBB, 0xBF]) {
        buf.drain(0..3);
    }
    Ok(buf)
}

pub fn load_csv_table(path: &Path, opts: &CsvFilterOptions) -> AppResult<CsvTableData> {
    let bytes = read_utf8_stripping_bom(path)?;
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .from_reader(bytes.as_slice());

    let all_headers: Vec<String> = reader
        .headers()
        .map_err(|e| format!("Failed to read CSV headers: {e}"))?
        .iter()
        .map(|s| s.to_string())
        .collect();

    let header_idx: HashMap<&str, usize> = all_headers
        .iter()
        .enumerate()
        .map(|(i, h)| (h.as_str(), i))
        .collect();

    let phone_col = header_idx.get("phone").copied();
    let email_col = header_idx.get("emails").copied();
    let website_col = header_idx.get("website").copied();
    let rating_col = header_idx.get("review_rating").copied();

    let selected_indices: Vec<usize> = match &opts.columns {
        Some(cols) if !cols.is_empty() => cols
            .iter()
            .filter_map(|c| header_idx.get(c.as_str()).copied())
            .collect(),
        _ => (0..all_headers.len()).collect(),
    };
    let headers: Vec<String> = selected_indices
        .iter()
        .map(|&i| all_headers[i].clone())
        .collect();

    let needle = opts
        .search
        .as_deref()
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty());

    let mut total_rows = 0usize;
    let mut filtered_rows = 0usize;
    let mut rows = Vec::new();
    let cap = opts.max_rows.unwrap_or(10_000);

    for rec in reader.records() {
        let record = rec.map_err(|e| format!("CSV row parse error: {e}"))?;
        total_rows += 1;

        let get_val = |idx: usize| -> &str { record.get(idx).unwrap_or("").trim() };

        if opts.has_phone {
            let has = phone_col.map(|i| !get_val(i).is_empty()).unwrap_or(false);
            if !has {
                continue;
            }
        }
        if opts.has_email {
            let has = email_col.map(|i| !get_val(i).is_empty()).unwrap_or(false);
            if !has {
                continue;
            }
        }
        if opts.no_website {
            let has_site = website_col.map(|i| !get_val(i).is_empty()).unwrap_or(false);
            if has_site {
                continue;
            }
        }
        if let Some(min_r) = opts.min_rating {
            let rating = rating_col
                .and_then(|i| get_val(i).parse::<f64>().ok())
                .unwrap_or(0.0);
            if rating < min_r {
                continue;
            }
        }

        if let Some(ref q) = needle {
            let matched = selected_indices
                .iter()
                .any(|&i| display_unguard(get_val(i)).to_ascii_lowercase().contains(q));
            if !matched {
                continue;
            }
        }

        filtered_rows += 1;
        if rows.len() < cap {
            let row: Vec<String> = selected_indices
                .iter()
                .map(|&i| display_unguard(record.get(i).unwrap_or("")).to_string())
                .collect();
            rows.push(row);
        }
    }

    Ok(CsvTableData {
        path: path.to_string_lossy().to_string(),
        headers,
        all_headers,
        rows,
        total_rows,
        filtered_rows,
    })
}

pub fn write_filtered_export(
    source_paths: &[PathBuf],
    dest_path: &Path,
    opts: &CsvFilterOptions,
    as_json: bool,
) -> AppResult<usize> {
    if source_paths.is_empty() {
        return Err("No source CSV files provided.".to_string());
    }

    let mut all_headers: Vec<String> = Vec::new();
    let mut merged_rows: Vec<HashMap<String, String>> = Vec::new();
    let mut seen_keys: HashSet<String> = HashSet::new();

    for src in source_paths {
        let bytes = read_utf8_stripping_bom(src)?;
        let mut reader = csv::ReaderBuilder::new()
            .flexible(true)
            .from_reader(bytes.as_slice());
        let headers: Vec<String> = reader
            .headers()
            .map_err(|e| format!("Failed to read headers from {}: {e}", src.display()))?
            .iter()
            .map(|s| s.to_string())
            .collect();
        for h in &headers {
            if !all_headers.contains(h) {
                all_headers.push(h.clone());
            }
        }
        for rec in reader.records() {
            let record = rec.map_err(|e| format!("CSV row error: {e}"))?;
            let mut map = HashMap::new();
            for (i, h) in headers.iter().enumerate() {
                let raw = record.get(i).unwrap_or("");
                map.insert(h.clone(), display_unguard(raw).to_string());
            }
            let dedupe_key = ["place_id", "data_id", "link", "title"]
                .iter()
                .find_map(|k| {
                    map.get(*k)
                        .map(|v| v.trim())
                        .filter(|v| !v.is_empty())
                        .map(|v| format!("{k}:{v}"))
                });
            if let Some(k) = dedupe_key {
                if !seen_keys.insert(k) {
                    continue;
                }
            }
            merged_rows.push(map);
        }
    }

    let needle = opts
        .search
        .as_deref()
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty());

    let out_cols: Vec<String> = match &opts.columns {
        Some(cols) if !cols.is_empty() => cols
            .iter()
            .filter(|c| all_headers.contains(c))
            .cloned()
            .collect(),
        _ => all_headers.clone(),
    };
    if out_cols.is_empty() {
        return Err("None of the requested columns exist in the scraped CSV.".to_string());
    }

    let filtered: Vec<&HashMap<String, String>> = merged_rows
        .iter()
        .filter(|row| {
            let get = |k: &str| row.get(k).map(|s| s.trim()).unwrap_or("");
            if opts.has_phone && get("phone").is_empty() {
                return false;
            }
            if opts.has_email && get("emails").is_empty() {
                return false;
            }
            if opts.no_website && !get("website").is_empty() {
                return false;
            }
            if let Some(min_r) = opts.min_rating {
                let r = get("review_rating").parse::<f64>().unwrap_or(0.0);
                if r < min_r {
                    return false;
                }
            }
            if let Some(ref q) = needle {
                if !out_cols
                    .iter()
                    .any(|c| get(c).to_ascii_lowercase().contains(q))
                {
                    return false;
                }
            }
            true
        })
        .collect();

    if let Some(parent) = dest_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create output folder: {e}"))?;
        }
    }

    if as_json {
        let json_rows: Vec<serde_json::Map<String, serde_json::Value>> = filtered
            .iter()
            .map(|row| {
                let mut obj = serde_json::Map::new();
                for col in &out_cols {
                    obj.insert(
                        col.clone(),
                        serde_json::Value::String(row.get(col).cloned().unwrap_or_default()),
                    );
                }
                obj
            })
            .collect();
        let body = serde_json::to_string_pretty(&json_rows).map_err(|e| e.to_string())?;
        fs::write(dest_path, body).map_err(|e| format!("Failed to write JSON: {e}"))?;
    } else {
        let mut out_bytes = vec![0xEF, 0xBB, 0xBF]; // UTF-8 BOM for Excel on Windows
        {
            let mut wtr = csv::Writer::from_writer(&mut out_bytes);
            wtr.write_record(&out_cols)
                .map_err(|e| format!("Failed to write CSV header: {e}"))?;
            for row in &filtered {
                let vals: Vec<String> = out_cols
                    .iter()
                    .map(|c| csv_safe(row.get(c).map(String::as_str).unwrap_or("")))
                    .collect();
                wtr.write_record(&vals)
                    .map_err(|e| format!("Failed to write CSV row: {e}"))?;
            }
            wtr.flush()
                .map_err(|e| format!("Failed to flush CSV writer: {e}"))?;
        }
        fs::write(dest_path, out_bytes).map_err(|e| format!("Failed to write CSV: {e}"))?;
    }

    Ok(filtered.len())
}

pub fn sanitize_output_filename(name: &str, default_ext: &str) -> AppResult<String> {
    let base = Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .trim();
    if base.is_empty() {
        return Err("Output filename cannot be empty.".to_string());
    }
    let clean: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '-'
            }
        })
        .collect();
    if clean.to_ascii_lowercase().ends_with(".csv")
        || clean.to_ascii_lowercase().ends_with(".json")
    {
        Ok(clean)
    } else {
        Ok(format!("{clean}.{default_ext}"))
    }
}

#[tauri::command]
pub fn list_csv_files(app: AppHandle) -> AppResult<Vec<CsvFileEntry>> {
    let kit_root = resolve_kit_root(&app)?;
    scan_csv_files(&kit_root)
}

#[tauri::command]
pub fn read_csv_table(path: String, options: Option<CsvFilterOptions>) -> AppResult<CsvTableData> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err(format!("CSV file does not exist: {path}"));
    }
    load_csv_table(&p, &options.unwrap_or_default())
}

#[tauri::command]
pub fn export_csv_file(
    source_path: String,
    dest_path: String,
    options: Option<CsvFilterOptions>,
) -> AppResult<usize> {
    let src = PathBuf::from(&source_path);
    if !src.is_file() {
        return Err(format!("Source CSV does not exist: {source_path}"));
    }
    let dst = PathBuf::from(&dest_path);
    let as_json = dst
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("json"))
        .unwrap_or(false);
    write_filtered_export(&[src], &dst, &options.unwrap_or_default(), as_json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn formula_guard_keeps_phones_and_escapes_formulas() {
        assert!(!is_formula_cell("+1 512-555-0100"));
        assert!(!is_formula_cell("+91 98200 12345"));
        assert!(is_formula_cell("=HYPERLINK(\"http://evil\")"));
        assert!(is_formula_cell("@SUM(A1:A2)"));
        assert!(is_formula_cell("+cmd|' /C calc'!A0"));
        assert_eq!(csv_safe("=1+1"), "'=1+1");
        assert_eq!(display_unguard("'=1+1"), "=1+1");
        assert_eq!(display_unguard("'Cafe"), "'Cafe");
    }

    #[test]
    fn filters_and_projects_csv_cleanly() {
        let uniq = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("gmaps_csv_test_{uniq}"));
        fs::create_dir_all(&dir).unwrap();
        let src = dir.join("in.csv");
        let dst = dir.join("out.csv");

        fs::write(
            &src,
            "\u{FEFF}title,phone,emails,website,review_rating\nCafe One,098200 11111,,https://a.com,4.5\nCafe Two,,,https://b.com,4.8\n'=Evil Shop,099999 22222,hi@evil.com,,4.1\n",
        )
        .unwrap();

        let opts = CsvFilterOptions {
            has_phone: true,
            columns: Some(vec!["title".into(), "phone".into()]),
            ..Default::default()
        };
        let table = load_csv_table(&src, &opts).unwrap();
        assert_eq!(table.total_rows, 3);
        assert_eq!(table.filtered_rows, 2);
        assert_eq!(table.headers, vec!["title", "phone"]);
        assert_eq!(table.rows[0], vec!["Cafe One", "098200 11111"]);
        assert_eq!(table.rows[1], vec!["=Evil Shop", "099999 22222"]);

        let written = write_filtered_export(&[src], &dst, &opts, false).unwrap();
        assert_eq!(written, 2);
        let exported = fs::read_to_string(&dst).unwrap();
        assert!(exported.contains("'=Evil Shop"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn dedupes_multi_city_csvs_and_exports_json() {
        let uniq = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("gmaps_dedupe_test_{uniq}"));
        fs::create_dir_all(&dir).unwrap();
        let c1 = dir.join("navi.csv");
        let c2 = dir.join("thane.csv");
        let dst_json = dir.join("merged.json");

        fs::write(
            &c1,
            "place_id,title,phone\nChIJ1,Cafe A,0981\nChIJ2,Cafe B,\n",
        )
        .unwrap();
        fs::write(
            &c2,
            "place_id,title,phone\nChIJ1,Cafe A,0981\nChIJ3,Dress Z,0983\n",
        )
        .unwrap();

        let opts = CsvFilterOptions {
            has_phone: true,
            columns: Some(vec!["title".into(), "phone".into()]),
            ..Default::default()
        };
        let written = write_filtered_export(&[c1, c2], &dst_json, &opts, true).unwrap();
        assert_eq!(written, 2);
        let raw = fs::read_to_string(&dst_json).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let arr = parsed.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["title"], "Cafe A");
        assert_eq!(arr[1]["title"], "Dress Z");

        let _ = fs::remove_dir_all(&dir);
    }
}

