use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use crate::config::{load_config, read_kit_env, resolve_kit_root};
use crate::error::AppResult;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const ENGINE_HEADER_PREFIX: &str = "gmskit-engine/";

pub struct EngineState {
    pub child: Mutex<Option<Child>>,
}

impl Default for EngineState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonInfo {
    pub executable: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub running: bool,
    pub managed_by_app: bool,
    pub foreign_port_busy: bool,
    pub port: u16,
    pub url: String,
    pub engine_version: Option<String>,
    pub python: Option<PythonInfo>,
    pub chrome_path: Option<String>,
}

fn new_hidden_command(bin: &str) -> Command {
    let mut cmd = Command::new(bin);
    cmd.stdin(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn parse_python_version(output: &str) -> Option<(u32, u32, String)> {
    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("Python ") {
            let parts: Vec<&str> = rest.split('.').collect();
            if parts.len() >= 2 {
                if let (Ok(maj), Ok(min)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) {
                    return Some((maj, min, rest.to_string()));
                }
            }
        }
    }
    None
}

pub fn detect_python(override_path: Option<&str>) -> Option<PythonInfo> {
    let mut candidates: Vec<&str> = Vec::new();
    if let Some(custom) = override_path.map(str::trim).filter(|s| !s.is_empty()) {
        candidates.push(custom);
    }
    candidates.extend(["python", "py", "python3"]);

    for bin in candidates {
        let Ok(out) = new_hidden_command(bin).arg("--version").output() else {
            continue;
        };
        if !out.status.success() {
            continue;
        }
        let combined = format!(
            "{}\n{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        if let Some((maj, min, ver)) = parse_python_version(&combined) {
            if maj > 3 || (maj == 3 && min >= 9) {
                return Some(PythonInfo {
                    executable: bin.to_string(),
                    version: ver,
                });
            }
        }
    }
    None
}

pub fn detect_chrome(kit_root: &Path, python_bin: Option<&str>) -> Option<String> {
    if let Some(py) = python_bin {
        let script = "import sys; sys.path.insert(0, 'engine'); import browser; print(browser.find_chrome() or '')";
        if let Ok(out) = new_hidden_command(py)
            .args(["-c", script])
            .current_dir(kit_root)
            .output()
        {
            if out.status.success() {
                let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !path.is_empty() {
                    return Some(path);
                }
            }
        }
    }
    None
}

#[derive(Debug, PartialEq, Eq)]
enum ProbeResult {
    Ours(String),
    Other,
    Down,
}

async fn probe_engine(port: u16, api_key: &str) -> ProbeResult {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .no_proxy()
        .build()
    {
        Ok(c) => c,
        Err(_) => return ProbeResult::Down,
    };

    let url = format!("http://127.0.0.1:{port}/api/v1/jobs");
    let mut req = client.get(&url);
    if !api_key.is_empty() {
        req = req.header("X-API-Key", api_key);
    }

    match req.send().await {
        Ok(resp) => {
            let hdr = resp
                .headers()
                .get("X-Engine")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            if let Some(ver) = hdr.strip_prefix(ENGINE_HEADER_PREFIX) {
                ProbeResult::Ours(ver.to_string())
            } else {
                ProbeResult::Other
            }
        }
        Err(_) => ProbeResult::Down,
    }
}

fn check_managed_alive(state: &EngineState) -> bool {
    let Ok(mut guard) = state.child.lock() else {
        return false;
    };
    if let Some(child) = guard.as_mut() {
        match child.try_wait() {
            Ok(None) => return true,
            _ => {
                *guard = None;
            }
        }
    }
    false
}

pub async fn status_internal(app: &AppHandle) -> AppResult<EngineStatus> {
    let kit_root = resolve_kit_root(app)?;
    let cfg = load_config(app);
    let env = read_kit_env(&kit_root);
    let state = app.state::<EngineState>();
    let managed_by_app = check_managed_alive(&state);

    let python = detect_python(cfg.python_override.as_deref());
    let chrome_path = detect_chrome(
        &kit_root,
        python.as_ref().map(|p| p.executable.as_str()),
    );

    let (running, foreign_port_busy, engine_version) =
        match probe_engine(env.port, &env.api_key).await {
            ProbeResult::Ours(ver) => (true, false, Some(ver)),
            ProbeResult::Other => (false, true, None),
            ProbeResult::Down => (false, false, None),
        };

    Ok(EngineStatus {
        running,
        managed_by_app,
        foreign_port_busy,
        port: env.port,
        url: format!("http://127.0.0.1:{}", env.port),
        engine_version,
        python,
        chrome_path,
    })
}

pub async fn start_internal(app: &AppHandle) -> AppResult<EngineStatus> {
    let cur = status_internal(app).await?;
    if cur.running {
        return Ok(cur);
    }
    if cur.foreign_port_busy {
        return Err(format!(
            "Port {} is already in use by another program. Change SCRAPER_PORT in Settings.",
            cur.port
        ));
    }

    let python = cur.python.clone().ok_or_else(|| {
        "Python 3.9+ was not found on PATH. Set a Python executable path in Settings.".to_string()
    })?;
    let kit_root = resolve_kit_root(app)?;
    let env = read_kit_env(&kit_root);
    let serve_py = kit_root.join("engine").join("serve.py");

    let mut cmd = new_hidden_command(&python.executable);
    cmd.arg(&serve_py)
        .arg("--port")
        .arg(env.port.to_string())
        .current_dir(&kit_root)
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    if let Some(ref chrome) = cur.chrome_path {
        cmd.env("CHROME", chrome);
    }
    cmd.env("SCRAPER_PORT", env.port.to_string());
    cmd.env("SCRAPER_NAV_TIMEOUT", env.nav_timeout.to_string());
    cmd.env("SCRAPER_HEADLESS", if env.headless { "1" } else { "0" });
    if !env.api_key.is_empty() {
        cmd.env("SCRAPER_API_KEY", &env.api_key);
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start engine/serve.py: {e}"))?;

    {
        let state = app.state::<EngineState>();
        let mut guard = state
            .child
            .lock()
            .map_err(|_| "Engine state lock poisoned".to_string())?;
        *guard = Some(child);
    }

    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        if let ProbeResult::Ours(_) = probe_engine(env.port, &env.api_key).await {
            return status_internal(app).await;
        }
        if !check_managed_alive(&app.state::<EngineState>()) {
            let tail = read_log_tail(&kit_root, 20).unwrap_or_default();
            return Err(format!(
                "Engine exited immediately on startup. Recent log:\n{tail}"
            ));
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }

    stop_managed_process(&app.state::<EngineState>());
    Err("Timed out waiting for the local engine to answer on localhost.".to_string())
}

pub fn stop_managed_process(state: &EngineState) -> bool {
    let Ok(mut guard) = state.child.lock() else {
        return false;
    };
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
        return true;
    }
    false
}

pub fn read_log_tail(kit_root: &Path, max_lines: usize) -> AppResult<String> {
    let log_path = kit_root.join(".engine").join("engine.log");
    if !log_path.is_file() {
        return Ok(String::new());
    }
    let content = fs::read_to_string(&log_path)
        .map_err(|e| format!("Failed to read engine.log: {e}"))?;
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    Ok(lines[start..].join("\n"))
}

#[tauri::command]
pub async fn get_engine_status(app: AppHandle) -> AppResult<EngineStatus> {
    status_internal(&app).await
}

#[tauri::command]
pub async fn start_engine(app: AppHandle) -> AppResult<EngineStatus> {
    start_internal(&app).await
}

#[tauri::command]
pub async fn stop_engine(app: AppHandle) -> AppResult<EngineStatus> {
    let state = app.state::<EngineState>();
    let stopped_managed = stop_managed_process(&state);

    if !stopped_managed {
        // Attempt graceful CLI stop if engine was started outside this app.
        let kit_root = resolve_kit_root(&app)?;
        let cfg = load_config(&app);
        if let Some(py) = detect_python(cfg.python_override.as_deref()) {
            let _ = new_hidden_command(&py.executable)
                .args(["scripts/engine.py", "stop"])
                .current_dir(&kit_root)
                .output();
        }
    }

    tokio::time::sleep(Duration::from_millis(250)).await;
    status_internal(&app).await
}

#[tauri::command]
pub async fn restart_engine(app: AppHandle) -> AppResult<EngineStatus> {
    let _ = stop_engine(app.clone()).await;
    start_internal(&app).await
}

#[tauri::command]
pub fn read_engine_logs(app: AppHandle, max_lines: Option<usize>) -> AppResult<String> {
    let kit_root = resolve_kit_root(&app)?;
    read_log_tail(&kit_root, max_lines.unwrap_or(200))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_python_version_ignoring_missing_launcher_message() {
        assert_eq!(parse_python_version("No installed Python found!\n"), None);
        assert_eq!(
            parse_python_version("Python 3.14.6\r\n"),
            Some((3, 14, "3.14.6".to_string()))
        );
        assert_eq!(
            parse_python_version("Python 3.9.1\n"),
            Some((3, 9, "3.9.1".to_string()))
        );
    }
}

