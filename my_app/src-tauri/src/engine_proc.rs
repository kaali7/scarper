use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
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
    pub lifecycle_lock: tokio::sync::Mutex<()>,
    pub cached_env: Mutex<Option<(String, Option<String>, Option<PythonInfo>, Option<String>)>>,
}

impl Default for EngineState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            lifecycle_lock: tokio::sync::Mutex::new(()),
            cached_env: Mutex::new(None),
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

pub(crate) fn new_hidden_command(bin: &str) -> Command {
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

fn get_cached_tools(
    state: &EngineState,
    kit_root: &Path,
    python_override: Option<&str>,
    force_refresh: bool,
) -> (Option<PythonInfo>, Option<String>) {
    let root_str = kit_root.to_string_lossy().to_string();
    let over = python_override.map(|s| s.to_string());
    if !force_refresh {
        if let Ok(guard) = state.cached_env.lock() {
            if let Some((r, o, py, ch)) = guard.as_ref() {
                if *r == root_str && *o == over {
                    return (py.clone(), ch.clone());
                }
            }
        }
    }
    let py = detect_python(python_override);
    let ch = detect_chrome(kit_root, py.as_ref().map(|p| p.executable.as_str()));
    if let Ok(mut guard) = state.cached_env.lock() {
        *guard = Some((root_str, over, py.clone(), ch.clone()));
    }
    (py, ch)
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

fn desktop_pid_file(kit_root: &Path) -> PathBuf {
    kit_root.join(".engine").join("desktop-engine.pid")
}

fn kill_pid_tree(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        let _ = new_hidden_command("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .output();
    }
}

fn find_serve_py_pids_for_port(port: u16) -> Vec<u32> {
    #[cfg(target_os = "windows")]
    {
        let ps = format!(
            "$pids = Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; \
             if ($pids) {{ Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {{ ($pids -contains $_.ProcessId) -and ($_.CommandLine -match 'serve\\.py') }} | Select-Object -ExpandProperty ProcessId }}"
        );
        if let Ok(out) = new_hidden_command("powershell")
            .args(["-NoProfile", "-Command", &ps])
            .output()
        {
            if out.status.success() {
                return String::from_utf8_lossy(&out.stdout)
                    .lines()
                    .filter_map(|l| l.trim().parse::<u32>().ok())
                    .collect();
            }
        }
        Vec::new()
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = port;
        Vec::new()
    }
}

async fn status_unlocked(app: &AppHandle, refresh_tools: bool) -> AppResult<EngineStatus> {
    let kit_root = resolve_kit_root(app)?;
    let cfg = load_config(app);
    let env = read_kit_env(&kit_root);
    let state = app.state::<EngineState>();
    let managed_by_app = check_managed_alive(&state);

    let (python, chrome_path) = get_cached_tools(
        &state,
        &kit_root,
        cfg.python_override.as_deref(),
        refresh_tools,
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

async fn start_unlocked(app: &AppHandle) -> AppResult<EngineStatus> {
    let cur = status_unlocked(app, true).await?;
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
    let child_pid = child.id();

    let _ = fs::create_dir_all(kit_root.join(".engine"));
    let _ = fs::write(desktop_pid_file(&kit_root), child_pid.to_string());

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
            return status_unlocked(app, false).await;
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

async fn stop_unlocked(app: &AppHandle) -> AppResult<EngineStatus> {
    let state = app.state::<EngineState>();
    let kit_root = resolve_kit_root(app)?;
    let env = read_kit_env(&kit_root);

    // 1. Stop process directly owned by this app instance (tree-kill on Windows).
    stop_managed_process(&state);

    // 2. Clean up orphaned desktop-engine.pid from an earlier dev reload/crash.
    let pid_file = desktop_pid_file(&kit_root);
    if let Ok(raw) = fs::read_to_string(&pid_file) {
        if let Ok(pid) = raw.trim().parse::<u32>() {
            kill_pid_tree(pid);
        }
        let _ = fs::remove_file(&pid_file);
    }

    // 3. If engine still answers on port, try scripts/engine.py stop, then port listener tree-kill.
    if let ProbeResult::Ours(_) = probe_engine(env.port, &env.api_key).await {
        let cfg = load_config(app);
        if let Some(py) = detect_python(cfg.python_override.as_deref()) {
            let _ = new_hidden_command(&py.executable)
                .args(["scripts/engine.py", "stop"])
                .current_dir(&kit_root)
                .output();
        }
    }

    if let ProbeResult::Ours(_) = probe_engine(env.port, &env.api_key).await {
        for pid in find_serve_py_pids_for_port(env.port) {
            kill_pid_tree(pid);
        }
    }

    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if probe_engine(env.port, &env.api_key).await == ProbeResult::Down {
            return status_unlocked(app, false).await;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    if let ProbeResult::Ours(_) = probe_engine(env.port, &env.api_key).await {
        return Err(format!(
            "Engine on port {} is still responding (if running inside Docker, run 'docker compose stop').",
            env.port
        ));
    }

    status_unlocked(app, false).await
}

pub async fn status_internal(app: &AppHandle) -> AppResult<EngineStatus> {
    status_unlocked(app, false).await
}

pub async fn start_internal(app: &AppHandle) -> AppResult<EngineStatus> {
    let state = app.state::<EngineState>();
    let _guard = state.lifecycle_lock.lock().await;
    start_unlocked(app).await
}

pub fn stop_managed_process(state: &EngineState) -> bool {
    let Ok(mut guard) = state.child.lock() else {
        return false;
    };
    if let Some(mut child) = guard.take() {
        let pid = child.id();
        kill_pid_tree(pid);
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
    status_unlocked(&app, false).await
}

#[tauri::command]
pub async fn start_engine(app: AppHandle) -> AppResult<EngineStatus> {
    start_internal(&app).await
}

#[tauri::command]
pub async fn stop_engine(app: AppHandle) -> AppResult<EngineStatus> {
    let state = app.state::<EngineState>();
    let _guard = state.lifecycle_lock.lock().await;
    stop_unlocked(&app).await
}

#[tauri::command]
pub async fn restart_engine(app: AppHandle) -> AppResult<EngineStatus> {
    let state = app.state::<EngineState>();
    let _guard = state.lifecycle_lock.lock().await;
    let _ = stop_unlocked(&app).await;
    start_unlocked(&app).await
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
