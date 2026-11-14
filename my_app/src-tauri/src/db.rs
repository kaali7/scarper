use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::AppHandle;

use crate::config::{read_kit_env, resolve_kit_root};
use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbJobEntry {
    pub id: String,
    pub name: String,
    pub date: String,
    pub status: String,
    pub error: String,
    pub keywords: Vec<String>,
    pub depth: i64,
    pub lang: String,
    pub country: String,
    pub email_enabled: bool,
    pub socials_enabled: bool,
    pub places: i64,
    pub percent: i64,
    pub stage: String,
    pub csv_path: String,
    pub csv_exists: bool,
    pub csv_size_bytes: u64,
}

fn mask_proxy(raw: &str) -> String {
    if let Ok(mut parsed) = reqwest::Url::parse(raw) {
        if parsed.password().is_some() || !parsed.username().is_empty() {
            let _ = parsed.set_password(Some("***"));
            return parsed.to_string();
        }
    }
    raw.to_string()
}

pub fn jobs_db_path(kit_root: &Path) -> std::path::PathBuf {
    kit_root.join(".engine").join("data").join("jobs.db")
}

pub fn job_csv_path(kit_root: &Path, job_id: &str) -> std::path::PathBuf {
    kit_root
        .join(".engine")
        .join("data")
        .join(format!("{job_id}.csv"))
}

pub fn read_jobs_from_db(kit_root: &Path) -> AppResult<Vec<DbJobEntry>> {
    let db_path = jobs_db_path(kit_root);
    if !db_path.is_file() {
        return Ok(Vec::new());
    }

    let conn = Connection::open_with_flags(
        &db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Failed to open jobs.db: {e}"))?;
    let _ = conn.busy_timeout(std::time::Duration::from_secs(5));

    let mut stmt = conn
        .prepare("SELECT id, name, date, status, data, error, progress FROM jobs ORDER BY rowid DESC")
        .map_err(|e| format!("Failed to query jobs.db: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        })
        .map_err(|e| format!("Failed to read jobs rows: {e}"))?;

    let mut out = Vec::new();
    for item in rows {
        let (id, name, date, status, data_raw, error, prog_raw) =
            item.map_err(|e| format!("Row read error: {e}"))?;
        let data: serde_json::Value = serde_json::from_str(&data_raw).unwrap_or_default();
        let prog: serde_json::Value = serde_json::from_str(&prog_raw).unwrap_or_default();

        // Keep mask_proxy referenced for parity when displaying raw data if needed later.
        let _proxies: Vec<String> = data["proxies"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(mask_proxy))
                    .collect()
            })
            .unwrap_or_default();

        let keywords = data["keywords"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        let depth = data["depth"].as_i64().unwrap_or(1);
        let lang = data["lang"].as_str().unwrap_or("en").to_string();
        let country = data["country"].as_str().unwrap_or("").to_string();
        let email_enabled = data["email"].as_bool().unwrap_or(false);
        let socials_enabled = data["socials"].as_bool().unwrap_or(false);

        let places = prog["places"].as_i64().unwrap_or(0);
        let percent = if status == "ok" {
            100
        } else {
            prog["percent"].as_i64().unwrap_or(0)
        };
        let stage = if status == "ok" {
            "done".to_string()
        } else {
            prog["stage"]
                .as_str()
                .unwrap_or(if status == "pending" { "queued" } else { "" })
                .to_string()
        };

        let csv_p = job_csv_path(kit_root, &id);
        let meta = fs::metadata(&csv_p).ok();
        let csv_exists = meta.as_ref().map(|m| m.is_file()).unwrap_or(false);
        let csv_size_bytes = meta.map(|m| m.len()).unwrap_or(0);

        out.push(DbJobEntry {
            id,
            name,
            date,
            status,
            error,
            keywords,
            depth,
            lang,
            country,
            email_enabled,
            socials_enabled,
            places,
            percent,
            stage,
            csv_path: csv_p.to_string_lossy().to_string(),
            csv_exists,
            csv_size_bytes,
        });
    }

    Ok(out)
}

#[tauri::command]
pub fn list_db_jobs(app: AppHandle) -> AppResult<Vec<DbJobEntry>> {
    let kit_root = resolve_kit_root(&app)?;
    read_jobs_from_db(&kit_root)
}

pub fn delete_local_jobs(kit_root: &Path, job_ids: &[String]) -> AppResult<usize> {
    if job_ids.is_empty() {
        return Ok(0);
    }
    let db_path = jobs_db_path(kit_root);
    if !db_path.is_file() {
        return Err("jobs.db does not exist.".to_string());
    }
    let mut conn =
        Connection::open(&db_path).map_err(|e| format!("Failed to open jobs.db: {e}"))?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start jobs.db transaction: {e}"))?;
    let mut deleted = 0usize;
    for job_id in job_ids {
        if !is_valid_uuid(job_id) {
            return Err(format!("Invalid job ID format: {job_id}"));
        }
        let affected = tx
            .execute("DELETE FROM jobs WHERE id = ?", [job_id])
            .map_err(|e| format!("Failed to delete job: {e}"))?;
        if affected > 0 {
            deleted += affected;
            let csv_p = job_csv_path(kit_root, job_id);
            let _ = fs::remove_file(&csv_p);
            let _ = fs::remove_file(format!("{}.tmp", csv_p.display()));
        }
    }
    tx.commit()
        .map_err(|e| format!("Failed to commit jobs.db delete: {e}"))?;
    Ok(deleted)
}

async fn delete_job_internal(
    client: &reqwest::Client,
    kit_root: &Path,
    env: &crate::config::KitEnv,
    job_id: &str,
) -> AppResult<bool> {
    if !is_valid_uuid(job_id) {
        return Err("Invalid job ID format.".to_string());
    }
    let url = format!("http://127.0.0.1:{}/api/v1/jobs/{job_id}", env.port);
    let mut req = client.delete(&url);
    if !env.api_key.is_empty() {
        req = req.header("X-API-Key", &env.api_key);
    }

    if let Ok(resp) = req.send().await {
        if resp.status().is_success() {
            return Ok(true);
        }
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(false);
        }
    }

    // Engine is stopped: remove directly from jobs.db and delete its CSV files.
    let deleted = delete_local_jobs(kit_root, &[job_id.to_string()])?;
    Ok(deleted > 0)
}

#[tauri::command]
pub async fn delete_db_job(app: AppHandle, job_id: String) -> AppResult<()> {
    let kit_root = resolve_kit_root(&app)?;
    let env = read_kit_env(&kit_root);
    let client = reqwest::Client::new();
    if delete_job_internal(&client, &kit_root, &env, &job_id).await? {
        Ok(())
    } else {
        Err(format!("Job {job_id} was not found."))
    }
}

#[tauri::command]
pub async fn clear_db_jobs(app: AppHandle, failed_only: bool) -> AppResult<usize> {
    let kit_root = resolve_kit_root(&app)?;
    let jobs = read_jobs_from_db(&kit_root)?;
    let target_ids: Vec<String> = jobs
        .into_iter()
        .filter(|j| !failed_only || j.status == "failed")
        .map(|j| j.id)
        .collect();
    if target_ids.is_empty() {
        return Ok(0);
    }

    let env = read_kit_env(&kit_root);
    let client = reqwest::Client::new();
    let mut deleted = 0usize;
    for job_id in &target_ids {
        if delete_job_internal(&client, &kit_root, &env, job_id).await? {
            deleted += 1;
        }
    }
    Ok(deleted)
}

pub fn read_job_raw(
    kit_root: &Path,
    job_id: &str,
) -> AppResult<(String, String, serde_json::Value, serde_json::Value)> {
    if !is_valid_uuid(job_id) {
        return Err("Invalid job ID format.".to_string());
    }
    let db_path = jobs_db_path(kit_root);
    if !db_path.is_file() {
        return Err("jobs.db does not exist.".to_string());
    }
    let conn = Connection::open_with_flags(
        &db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("Failed to open jobs.db: {e}"))?;
    let _ = conn.busy_timeout(std::time::Duration::from_secs(5));
    let row = conn
        .query_row(
            "SELECT name, status, data, progress FROM jobs WHERE id = ?",
            [job_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            },
        )
        .map_err(|e| format!("Job {job_id} was not found: {e}"))?;
    let data: serde_json::Value = serde_json::from_str(&row.2).unwrap_or_default();
    let progress: serde_json::Value = serde_json::from_str(&row.3).unwrap_or_default();
    Ok((row.0, row.1, data, progress))
}

pub fn reset_job_for_resume(kit_root: &Path, job_id: &str) -> AppResult<()> {
    if !is_valid_uuid(job_id) {
        return Err("Invalid job ID format.".to_string());
    }
    let db_path = jobs_db_path(kit_root);
    if !db_path.is_file() {
        return Err("jobs.db does not exist.".to_string());
    }
    let conn = Connection::open(&db_path).map_err(|e| format!("Failed to open jobs.db: {e}"))?;
    let raw_prog: String = conn
        .query_row("SELECT progress FROM jobs WHERE id = ?", [job_id], |r| {
            r.get(0)
        })
        .map_err(|e| format!("Job {job_id} was not found: {e}"))?;
    let mut prog: serde_json::Value =
        serde_json::from_str(&raw_prog).unwrap_or_else(|_| serde_json::json!({}));
    if let Some(obj) = prog.as_object_mut() {
        obj.insert("resumes".to_string(), serde_json::json!(0));
    }
    let next_prog = serde_json::to_string(&prog).unwrap_or_else(|_| "{}".to_string());
    conn.execute(
        "UPDATE jobs SET status = 'working', error = '', progress = ? WHERE id = ?",
        [&next_prog, job_id],
    )
    .map_err(|e| format!("Failed to reset job for resume: {e}"))?;
    Ok(())
}

pub fn is_valid_uuid(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    let expected = [8, 4, 4, 4, 12];
    parts.len() == 5
        && parts
            .iter()
            .zip(expected)
            .all(|(p, len)| p.len() == len && p.chars().all(|c| c.is_ascii_hexdigit()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn reads_jobs_db_and_csv_metadata() {
        let uniq = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let tmp = std::env::temp_dir().join(format!("gmaps_db_test_{uniq}"));
        let data_dir = tmp.join(".engine").join("data");
        fs::create_dir_all(&data_dir).unwrap();

        let db_path = data_dir.join("jobs.db");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute(
            "CREATE TABLE jobs (id TEXT PRIMARY KEY, name TEXT NOT NULL, date TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', progress TEXT NOT NULL DEFAULT '{}')",
            [],
        )
        .unwrap();
        let jid = "11111111-2222-3333-4444-555555555555";
        conn.execute(
            "INSERT INTO jobs (id, name, date, status, data, error, progress) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                jid,
                "coffee shops @ Navi Mumbai",
                "2026-11-11T08:36:34+00:00",
                "ok",
                r#"{"keywords":["coffee shops"],"depth":5,"lang":"en","country":"in","email":false,"socials":false}"#,
                "",
                r#"{"places":97,"percent":100,"stage":"done"}"#,
            ],
        )
        .unwrap();
        drop(conn);

        fs::write(data_dir.join(format!("{jid}.csv")), "title,phone\nCafe 1,0999\n").unwrap();

        let entries = read_jobs_from_db(&tmp).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "coffee shops @ Navi Mumbai");
        assert_eq!(entries[0].places, 97);
        assert!(entries[0].csv_exists);
        assert!(entries[0].csv_size_bytes > 0);

        let removed = delete_local_jobs(&tmp, &[jid.to_string()]).unwrap();
        assert_eq!(removed, 1);
        assert!(read_jobs_from_db(&tmp).unwrap().is_empty());
        assert!(!data_dir.join(format!("{jid}.csv")).exists());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn reads_raw_job_and_resets_resume_counter() {
        let uniq = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let tmp = std::env::temp_dir().join(format!("gmaps_db_resume_{uniq}"));
        let data_dir = tmp.join(".engine").join("data");
        fs::create_dir_all(&data_dir).unwrap();

        let db_path = data_dir.join("jobs.db");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute(
            "CREATE TABLE jobs (id TEXT PRIMARY KEY, name TEXT NOT NULL, date TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', progress TEXT NOT NULL DEFAULT '{}')",
            [],
        )
        .unwrap();
        let jid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        conn.execute(
            "INSERT INTO jobs (id, name, date, status, data, error, progress) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                jid,
                "Medical Spas",
                "2026-11-12T07:30:26+00:00",
                "working",
                r#"{"keywords":["Medical Spas","Dentists"],"depth":5}"#,
                "interrupted",
                r#"{"places":20,"percent":10,"resumes":3}"#,
            ],
        )
        .unwrap();
        drop(conn);

        let (name, status, data, _prog) = read_job_raw(&tmp, jid).unwrap();
        assert_eq!(name, "Medical Spas");
        assert_eq!(status, "working");
        assert_eq!(data["depth"].as_i64(), Some(5));

        reset_job_for_resume(&tmp, jid).unwrap();
        let (_n, status_after, _d, prog_after) = read_job_raw(&tmp, jid).unwrap();
        assert_eq!(status_after, "working");
        assert_eq!(prog_after["resumes"].as_i64(), Some(0));
        assert_eq!(prog_after["places"].as_i64(), Some(20));

        let _ = fs::remove_dir_all(&tmp);
    }
}

