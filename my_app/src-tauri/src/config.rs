use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::error::AppResult;

const KEYRING_SERVICE: &str = "gmaps-scraper-desktop";
const KEYRING_USER_GROQ: &str = "groq_api_key";
const CONFIG_FILE: &str = "desktop_config.json";
pub const DEFAULT_GROQ_MODEL: &str = "qwen/qwen3.8-27b";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopConfig {
    pub kit_root: String,
    pub python_override: Option<String>,
    pub groq_model: String,
}

impl Default for DesktopConfig {
    fn default() -> Self {
        Self {
            kit_root: detect_kit_root()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
            python_override: None,
            groq_model: DEFAULT_GROQ_MODEL.to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KitEnv {
    pub port: u16,
    pub api_key: String,
    pub headless: bool,
    pub nav_timeout: u64,
    pub no_update_check: bool,
}

impl Default for KitEnv {
    fn default() -> Self {
        Self {
            port: 8080,
            api_key: String::new(),
            headless: true,
            nav_timeout: 90,
            no_update_check: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSummary {
    pub config: DesktopConfig,
    pub kit_env: KitEnv,
    pub has_groq_key: bool,
    pub groq_key_masked: String,
}

pub fn normalize_kit_root_path(path: &Path) -> PathBuf {
    if path.join("engine").join("serve.py").is_file() {
        path.to_path_buf()
    } else if path.join("tools").join("map_scraper").join("engine").join("serve.py").is_file() {
        path.join("tools").join("map_scraper")
    } else if path.join("map_scraper").join("engine").join("serve.py").is_file() {
        path.join("map_scraper")
    } else {
        path.to_path_buf()
    }
}

pub fn is_valid_kit_root(path: &Path) -> bool {
    let normalized = normalize_kit_root_path(path);
    normalized.join("engine").join("serve.py").is_file()
        && normalized.join("scripts").join("engine.py").is_file()
}

pub fn detect_kit_root() -> Option<PathBuf> {
    let mut seeds = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        seeds.push(cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            seeds.push(parent.to_path_buf());
        }
    }
    for seed in seeds {
        let mut cur = Some(seed.as_path());
        while let Some(dir) = cur {
            if is_valid_kit_root(dir) {
                return Some(normalize_kit_root_path(dir));
            }
            cur = dir.parent();
        }
    }
    let tools_map_fallback = PathBuf::from(r"c:\kali\product\scraper\tools\map_scraper");
    if is_valid_kit_root(&tools_map_fallback) {
        return Some(tools_map_fallback);
    }
    let map_fallback = PathBuf::from(r"c:\kali\product\scraper\map_scraper");
    if is_valid_kit_root(&map_fallback) {
        return Some(map_fallback);
    }
    let fallback = PathBuf::from(r"c:\kali\product\scraper");
    if is_valid_kit_root(&fallback) {
        return Some(normalize_kit_root_path(&fallback));
    }
    None
}

fn config_path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
    Ok(dir.join(CONFIG_FILE))
}

pub fn load_config(app: &AppHandle) -> DesktopConfig {
    let Ok(path) = config_path(app) else {
        return DesktopConfig::default();
    };
    let mut cfg: DesktopConfig = fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();

    if cfg.kit_root.trim().is_empty() || !is_valid_kit_root(Path::new(&cfg.kit_root)) {
        if let Some(detected) = detect_kit_root() {
            cfg.kit_root = detected.to_string_lossy().to_string();
        }
    }
    if cfg.groq_model.trim().is_empty()
        || matches!(
            cfg.groq_model.trim(),
            "llama-3.3-70b-versatile" | "qwen/qwen3-32b"
        )
    {
        cfg.groq_model = DEFAULT_GROQ_MODEL.to_string();
    }
    cfg
}

pub fn save_config_to_disk(app: &AppHandle, cfg: &DesktopConfig) -> AppResult<()> {
    let path = config_path(app)?;
    let raw = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| format!("Failed to save config: {e}"))
}

pub fn resolve_kit_root(app: &AppHandle) -> AppResult<PathBuf> {
    let cfg = load_config(app);
    let p = PathBuf::from(&cfg.kit_root);
    let norm = normalize_kit_root_path(&p);
    if norm.join("engine").join("serve.py").is_file() {
        Ok(norm)
    } else if let Some(detected) = detect_kit_root() {
        Ok(detected)
    } else {
        Err(format!(
            "Kit root '{}' does not contain map_scraper/engine/serve.py or engine/serve.py. Set the kit folder in Settings.",
            cfg.kit_root
        ))
    }
}

fn strip_env_value(raw: &str) -> String {
    let v = raw.trim();
    if let Some(first) = v.chars().next() {
        if (first == '"' || first == '\'') && v.len() >= 2 {
            if let Some(end) = v[1..].find(first) {
                return v[1..1 + end].to_string();
            }
        }
    }
    v.split(" #").next().unwrap_or("").trim().to_string()
}

pub fn parse_env_text(content: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let clean = content.trim_start_matches('\u{FEFF}');
    for line in clean.lines() {
        let mut s = line.trim();
        if s.is_empty() || s.starts_with('#') {
            continue;
        }
        if let Some(rest) = s.strip_prefix("export ") {
            s = rest.trim_start();
        }
        if let Some((k, v)) = s.split_once('=') {
            map.insert(k.trim().to_string(), strip_env_value(v));
        }
    }
    map
}

pub fn read_kit_env(kit_root: &Path) -> KitEnv {
    let norm = normalize_kit_root_path(kit_root);
    let env_path = if norm.join(".env").is_file() {
        norm.join(".env")
    } else {
        kit_root.join(".env")
    };
    let map = fs::read_to_string(env_path)
        .map(|s| parse_env_text(&s))
        .unwrap_or_default();

    let port = map
        .get("SCRAPER_PORT")
        .and_then(|v| v.parse::<u16>().ok())
        .filter(|&p| p > 0)
        .unwrap_or(8080);
    let api_key = map.get("SCRAPER_API_KEY").cloned().unwrap_or_default();
    let headless = map
        .get("SCRAPER_HEADLESS")
        .map(|v| {
            !matches!(
                v.trim().to_ascii_lowercase().as_str(),
                "0" | "false" | "no" | "off"
            )
        })
        .unwrap_or(true);
    let nav_timeout = map
        .get("SCRAPER_NAV_TIMEOUT")
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|&t| t >= 5)
        .unwrap_or(90);
    let no_update_check = map
        .get("SCRAPER_NO_UPDATE_CHECK")
        .map(|v| {
            matches!(
                v.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes"
            )
        })
        .unwrap_or(false);

    KitEnv {
        port,
        api_key,
        headless,
        nav_timeout,
        no_update_check,
    }
}

pub fn write_kit_env(kit_root: &Path, env: &KitEnv) -> AppResult<()> {
    let norm = normalize_kit_root_path(kit_root);
    let env_path = if norm.join(".env").is_file() || norm.join(".env.example").is_file() {
        norm.join(".env")
    } else {
        kit_root.join(".env")
    };
    let mut lines: Vec<String> = if env_path.is_file() {
        fs::read_to_string(&env_path)
            .map_err(|e| format!("Failed to read .env: {e}"))?
            .lines()
            .map(|s| s.to_string())
            .collect()
    } else if norm.join(".env.example").is_file() {
        fs::read_to_string(norm.join(".env.example"))
            .map_err(|e| format!("Failed to read .env.example: {e}"))?
            .lines()
            .map(|s| s.to_string())
            .collect()
    } else if kit_root.join(".env.example").is_file() {
        fs::read_to_string(kit_root.join(".env.example"))
            .map_err(|e| format!("Failed to read .env.example: {e}"))?
            .lines()
            .map(|s| s.to_string())
            .collect()
    } else {
        Vec::new()
    };

    let updates = [
        ("SCRAPER_PORT", env.port.to_string()),
        ("SCRAPER_API_KEY", env.api_key.clone()),
        (
            "SCRAPER_HEADLESS",
            if env.headless { "1" } else { "0" }.to_string(),
        ),
        ("SCRAPER_NAV_TIMEOUT", env.nav_timeout.max(5).to_string()),
        (
            "SCRAPER_NO_UPDATE_CHECK",
            if env.no_update_check { "1" } else { "0" }.to_string(),
        ),
    ];

    for (key, val) in updates {
        let mut found = false;
        for line in &mut lines {
            let trimmed = line.trim().trim_start_matches('#').trim();
            if let Some((k, _)) = trimmed.split_once('=') {
                if k.trim() == key {
                    *line = format!("{key}={val}");
                    found = true;
                }
            }
        }
        if !found {
            lines.push(format!("{key}={val}"));
        }
    }

    let content = lines.join("\n") + "\n";
    fs::write(&env_path, content).map_err(|e| format!("Failed to write .env: {e}"))
}

fn groq_key_fallback_path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
    Ok(dir.join("groq_api.key"))
}

pub fn read_groq_key_from_env_file(kit_root: &Path) -> Option<String> {
    let raw = fs::read_to_string(kit_root.join(".env")).ok()?;
    let map = parse_env_text(&raw);
    for key_name in ["GROQ_API_KEY", "GRAQ_API_KEY"] {
        if let Some(val) = map.get(key_name) {
            let trimmed = val.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn clear_groq_key_in_env_file(kit_root: &Path) {
    let env_path = kit_root.join(".env");
    let Ok(raw) = fs::read_to_string(&env_path) else {
        return;
    };
    let mut changed = false;
    let kept: Vec<&str> = raw
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            let rest = trimmed.strip_prefix("export ").unwrap_or(trimmed).trim_start();
            let is_groq_line = rest
                .split_once('=')
                .map(|(k, _)| matches!(k.trim(), "GROQ_API_KEY" | "GRAQ_API_KEY"))
                .unwrap_or(false);
            if is_groq_line {
                changed = true;
                false
            } else {
                true
            }
        })
        .collect();
    if changed {
        let updated = if kept.is_empty() {
            String::new()
        } else {
            kept.join("\n") + "\n"
        };
        let _ = fs::write(env_path, updated);
    }
}

pub fn get_groq_api_key_internal(app: &AppHandle) -> AppResult<Option<String>> {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_GROQ) {
        if let Ok(pw) = entry.get_password() {
            let trimmed = pw.trim().to_string();
            if !trimmed.is_empty() {
                return Ok(Some(trimmed));
            }
        }
    }
    if let Ok(path) = groq_key_fallback_path(app) {
        if let Ok(raw) = fs::read_to_string(path) {
            let trimmed = raw.trim().to_string();
            if !trimmed.is_empty() {
                return Ok(Some(trimmed));
            }
        }
    }
    for env_name in ["GROQ_API_KEY", "GRAQ_API_KEY"] {
        if let Ok(env_val) = std::env::var(env_name) {
            let trimmed = env_val.trim().to_string();
            if !trimmed.is_empty() {
                return Ok(Some(trimmed));
            }
        }
    }
    let cfg = load_config(app);
    if !cfg.kit_root.trim().is_empty() {
        if let Some(val) = read_groq_key_from_env_file(Path::new(&cfg.kit_root)) {
            return Ok(Some(val));
        }
    }
    if let Some(detected) = detect_kit_root() {
        if let Some(val) = read_groq_key_from_env_file(&detected) {
            return Ok(Some(val));
        }
    }
    Ok(None)
}

pub fn mask_secret(secret: &str) -> String {
    let chars: Vec<char> = secret.chars().collect();
    if chars.len() <= 8 {
        return "*".repeat(chars.len());
    }
    let head: String = chars.iter().take(4).collect();
    let tail: String = chars.iter().skip(chars.len() - 4).collect();
    format!("{head}••••••••{tail}")
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> AppResult<SettingsSummary> {
    let config = load_config(&app);
    let kit_env = Path::new(&config.kit_root)
        .exists()
        .then(|| read_kit_env(Path::new(&config.kit_root)))
        .unwrap_or_default();
    let key = get_groq_api_key_internal(&app).ok().flatten();
    let has_groq_key = key.is_some();
    let groq_key_masked = key.as_deref().map(mask_secret).unwrap_or_default();

    Ok(SettingsSummary {
        config,
        kit_env,
        has_groq_key,
        groq_key_masked,
    })
}

#[tauri::command]
pub fn save_desktop_settings(
    app: AppHandle,
    kit_root: String,
    python_override: Option<String>,
    groq_model: String,
    kit_env: Option<KitEnv>,
) -> AppResult<SettingsSummary> {
    let trimmed_root = kit_root.trim().to_string();
    if !is_valid_kit_root(Path::new(&trimmed_root)) {
        return Err(format!(
            "Folder '{trimmed_root}' does not contain map_scraper/engine/serve.py or engine/serve.py."
        ));
    }
    let clean_py = python_override
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let clean_model = if groq_model.trim().is_empty() {
        DEFAULT_GROQ_MODEL.to_string()
    } else {
        groq_model.trim().to_string()
    };

    let cfg = DesktopConfig {
        kit_root: trimmed_root.clone(),
        python_override: clean_py,
        groq_model: clean_model,
    };
    save_config_to_disk(&app, &cfg)?;

    let engine_state = app.state::<crate::engine_proc::EngineState>();
    if let Ok(mut guard) = engine_state.cached_env.lock() {
        *guard = None;
    }

    if let Some(env_cfg) = kit_env {
        if env_cfg.port == 0 {
            return Err("SCRAPER_PORT must be between 1 and 65535.".to_string());
        }
        write_kit_env(Path::new(&trimmed_root), &env_cfg)?;
    }

    get_settings(app)
}

#[tauri::command]
pub fn set_groq_api_key(app: AppHandle, api_key: String) -> AppResult<String> {
    let clean = api_key.trim().to_string();
    if clean.is_empty() {
        return Err("Groq API key cannot be empty.".to_string());
    }
    let mut stored_anywhere = false;
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_GROQ) {
        if entry.set_password(&clean).is_ok() {
            stored_anywhere = true;
        }
    }
    // Always mirror to app_data_dir fallback if keyring fails or on restricted sessions.
    if let Ok(path) = groq_key_fallback_path(&app) {
        if fs::write(&path, &clean).is_ok() {
            stored_anywhere = true;
        }
    }
    if !stored_anywhere {
        return Err("Failed to store Groq API key in OS credential store or local app data.".to_string());
    }
    Ok(mask_secret(&clean))
}

#[tauri::command]
pub fn clear_groq_api_key(app: AppHandle) -> AppResult<()> {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_GROQ) {
        let _ = entry.delete_credential();
    }
    if let Ok(path) = groq_key_fallback_path(&app) {
        let _ = fs::remove_file(path);
    }
    let cfg = load_config(&app);
    if !cfg.kit_root.trim().is_empty() {
        clear_groq_key_in_env_file(Path::new(&cfg.kit_root));
    }
    if let Some(detected) = detect_kit_root() {
        clear_groq_key_in_env_file(&detected);
    }
    Ok(())
}

#[tauri::command]
pub async fn test_groq_connection(app: AppHandle) -> AppResult<Vec<String>> {
    let key = get_groq_api_key_internal(&app)?
        .ok_or_else(|| "No Groq API key is saved yet. Save your key in Settings first.".to_string())?;
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.groq.com/openai/v1/models")
        .bearer_auth(&key)
        .send()
        .await
        .map_err(|e| format!("Failed to reach Groq API: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Groq API returned HTTP {status}: {body}"));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Invalid Groq API response: {e}"))?;
    let mut models: Vec<String> = json["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    models.sort();
    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_env_quotes_comments_and_last_wins() {
        let sample = "\u{FEFF}# comment\nexport SCRAPER_PORT=8081 # override\nSCRAPER_PORT=\"8082\"\nSCRAPER_API_KEY='secret # kept'\nSCRAPER_HEADLESS=0\nSCRAPER_NAV_TIMEOUT=120\n";
        let m = parse_env_text(sample);
        assert_eq!(m.get("SCRAPER_PORT").map(String::as_str), Some("8082"));
        assert_eq!(
            m.get("SCRAPER_API_KEY").map(String::as_str),
            Some("secret # kept")
        );
        assert_eq!(m.get("SCRAPER_HEADLESS").map(String::as_str), Some("0"));
        assert_eq!(m.get("SCRAPER_NAV_TIMEOUT").map(String::as_str), Some("120"));
    }

    #[test]
    fn masks_secrets_safely() {
        assert_eq!(mask_secret("gsk_1234567890abcd"), "gsk_••••••••abcd");
        assert_eq!(mask_secret("short"), "*****");
    }

    #[test]
    fn reads_and_clears_groq_key_from_env_file() {
        use std::time::{SystemTime, UNIX_EPOCH};
        let uniq = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let tmp = std::env::temp_dir().join(format!("gmaps_cfg_test_{uniq}"));
        fs::create_dir_all(&tmp).unwrap();

        fs::write(
            tmp.join(".env"),
            "SCRAPER_PORT=8080\nGRAQ_API_KEY=\"gsk_typo_key_1234\"\n",
        )
        .unwrap();
        assert_eq!(
            read_groq_key_from_env_file(&tmp).as_deref(),
            Some("gsk_typo_key_1234")
        );

        fs::write(
            tmp.join(".env"),
            "SCRAPER_PORT=8080\nGRAQ_API_KEY=\"gsk_typo\"\nGROQ_API_KEY=\"gsk_real_key_5678\"\n",
        )
        .unwrap();
        assert_eq!(
            read_groq_key_from_env_file(&tmp).as_deref(),
            Some("gsk_real_key_5678")
        );

        clear_groq_key_in_env_file(&tmp);
        assert!(read_groq_key_from_env_file(&tmp).is_none());
        let remaining = fs::read_to_string(tmp.join(".env")).unwrap();
        assert!(remaining.contains("SCRAPER_PORT=8080"));

        let _ = fs::remove_dir_all(&tmp);
    }
}

