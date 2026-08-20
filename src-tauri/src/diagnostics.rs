//! 模块说明: 本地诊断状态、敏感信息脱敏、日志保留和诊断压缩包导出。
//! 功能描述: 向启动页与原生菜单提供不包含用户会话或 DSH 配置的安全诊断接口。

use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};
use tauri::State;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_updater::UpdaterExt;
use zip::write::SimpleFileOptions;

/// 单次应用运行的可共享诊断状态。
pub struct DiagnosticsState {
    /// 本次运行关联 ID。
    pub run_id: String,
    /// 当前日志目录。
    pub log_dir: PathBuf,
    /// 应用启动时刻。
    pub started_at: Instant,
    phase: Mutex<String>,
    last_error: Mutex<Option<String>>,
}

impl DiagnosticsState {
    /// 创建新的诊断状态。
    pub fn new(run_id: String, log_dir: PathBuf) -> Self {
        Self {
            run_id,
            log_dir,
            started_at: Instant::now(),
            phase: Mutex::new("initializing".into()),
            last_error: Mutex::new(None),
        }
    }

    /// 更新当前启动阶段。
    pub fn set_phase(&self, phase: impl Into<String>) {
        *self.phase.lock().unwrap_or_else(|e| e.into_inner()) = phase.into();
    }

    /// 保存经过脱敏的最近错误。
    pub fn set_error(&self, error: impl AsRef<str>) {
        *self.last_error.lock().unwrap_or_else(|e| e.into_inner()) = Some(redact(error.as_ref()));
    }

    /// 构造可公开复制的诊断摘要。
    pub fn summary(&self, version: &str) -> DiagnosticSummary {
        DiagnosticSummary {
            app_version: version.into(),
            platform: std::env::consts::OS.into(),
            arch: std::env::consts::ARCH.into(),
            run_id: self.run_id.clone(),
            phase: self.phase.lock().unwrap_or_else(|e| e.into_inner()).clone(),
            duration_ms: self.started_at.elapsed().as_millis(),
            error_summary: self
                .last_error
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone(),
            log_path: self.log_dir.display().to_string(),
        }
    }
}

/// 可安全展示或导出的诊断摘要。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticSummary {
    pub app_version: String,
    pub platform: String,
    pub arch: String,
    pub run_id: String,
    pub phase: String,
    pub duration_ms: u128,
    pub error_summary: Option<String>,
    pub log_path: String,
}

/// 更新检查结果，下载与安装必须由用户后续确认触发。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub available: bool,
    pub version: Option<String>,
    pub body: Option<String>,
}

/// 对日志文本执行保守脱敏。
pub fn redact(input: &str) -> String {
    let home =
        std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
    let mut value = home
        .map(|p| input.replace(&p.display().to_string(), "$HOME"))
        .unwrap_or_else(|| input.to_string());
    for marker in ["sk-", "Bearer ", "Authorization:", "Cookie:"] {
        let mut cursor = 0;
        loop {
            let lowered = value[cursor..].to_ascii_lowercase();
            let Some(relative) = lowered.find(&marker.to_ascii_lowercase()) else {
                break;
            };
            let start = cursor + relative;
            let secret_start = start + marker.len();
            let end = value[secret_start..]
                .find(|c: char| c.is_whitespace() || c == '"' || c == '\'')
                .map(|n| secret_start + n)
                .unwrap_or(value.len());
            value.replace_range(secret_start..end, "[REDACTED]");
            cursor = secret_start + "[REDACTED]".len();
        }
    }
    value
}

/// 清理超过 14 天或使目录总量超过 100 MiB 的旧日志。
pub fn enforce_log_retention(log_dir: &Path) {
    let mut files: Vec<_> = fs::read_dir(log_dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            Some((
                entry.path(),
                metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                metadata.len(),
            ))
        })
        .collect();
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(14 * 24 * 60 * 60))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    for (path, modified, _) in &files {
        if *modified < cutoff {
            let _ = fs::remove_file(path);
        }
    }
    files.retain(|(path, _, _)| path.exists());
    files.sort_by_key(|(_, modified, _)| *modified);
    let mut total: u64 = files.iter().map(|(_, _, size)| size).sum();
    for (path, _, size) in files {
        if total <= 100 * 1024 * 1024 {
            break;
        }
        if fs::remove_file(path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
}

/// 返回当前诊断摘要。
#[tauri::command]
pub fn get_diagnostics_summary(
    state: State<'_, DiagnosticsState>,
    app: tauri::AppHandle,
) -> DiagnosticSummary {
    state.summary(&app.package_info().version.to_string())
}

/// 将脱敏诊断摘要复制到系统剪贴板。
#[tauri::command]
pub fn copy_diagnostics_summary(
    state: State<'_, DiagnosticsState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let summary =
        serde_json::to_string_pretty(&state.summary(&app.package_info().version.to_string()))
            .map_err(|e| e.to_string())?;
    app.clipboard()
        .write_text(summary)
        .map_err(|e| e.to_string())
}

/// 使用系统文件管理器打开日志目录。
#[tauri::command]
pub fn open_log_directory(state: State<'_, DiagnosticsState>) -> Result<(), String> {
    open_log_directory_path(&state.log_dir)
}

/// 使用系统文件管理器打开给定目录，供 IPC 与原生菜单复用。
pub fn open_log_directory_path(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("explorer");
        cmd.arg(path);
        cmd
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(path);
        cmd
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(path);
        cmd
    };
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// 将诊断摘要和近期脱敏日志导出为 ZIP，不读取 DSH_HOME 或工作区。
#[tauri::command]
pub fn export_diagnostics(
    destination: String,
    state: State<'_, DiagnosticsState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    export_diagnostics_to(
        Path::new(&destination),
        state.inner(),
        &app.package_info().version.to_string(),
    )
}

/// 将诊断包导出到日志目录中的默认安全路径，供启动错误页使用。
#[tauri::command]
pub fn export_diagnostics_default(
    state: State<'_, DiagnosticsState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let destination = state
        .log_dir
        .join(format!("diagnostics-{}.zip", state.run_id));
    export_diagnostics_to(
        &destination,
        state.inner(),
        &app.package_info().version.to_string(),
    )
}

/// 将诊断内容写到指定路径，供 IPC 与原生菜单复用。
pub fn export_diagnostics_to(
    destination: &Path,
    state: &DiagnosticsState,
    version: &str,
) -> Result<String, String> {
    let destination = destination.to_path_buf();
    let file = fs::File::create(&destination).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let summary =
        serde_json::to_string_pretty(&state.summary(version)).map_err(|e| e.to_string())?;
    zip.start_file("diagnostics.json", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(summary.as_bytes())
        .map_err(|e| e.to_string())?;
    let mut logs: Vec<_> = fs::read_dir(&state.log_dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|entry| {
            entry.path().is_file() && entry.file_name().to_string_lossy().contains("harness.log")
        })
        .collect();
    logs.sort_by_key(|entry| {
        entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH)
    });
    for entry in logs.into_iter().rev().take(3) {
        let mut content = String::new();
        fs::File::open(entry.path())
            .and_then(|mut f| f.read_to_string(&mut content))
            .map_err(|e| e.to_string())?;
        zip.start_file(
            format!("logs/{}", entry.file_name().to_string_lossy()),
            options,
        )
        .map_err(|e| e.to_string())?;
        zip.write_all(redact(&content).as_bytes())
            .map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(destination.display().to_string())
}

/// 从签名的 GitHub Releases 更新源检查新版本，不自动下载或安装。
#[tauri::command]
pub async fn check_for_update(app: tauri::AppHandle) -> Result<UpdateStatus, String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    Ok(match update {
        Some(update) => UpdateStatus {
            available: true,
            version: Some(update.version),
            body: update.body,
        },
        None => UpdateStatus {
            available: false,
            version: None,
            body: None,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_secrets_and_home_paths() {
        let input = format!(
            "Authorization: Bearer abc sk-secret {}",
            std::env::var("USERPROFILE").unwrap_or_default()
        );
        let output = redact(&input);
        assert!(!output.contains("abc"));
        assert!(!output.contains("sk-secret"));
    }

    #[test]
    fn enforces_total_log_size_limit() {
        let dir = std::env::temp_dir().join(format!("harness-log-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        for index in 0..3 {
            fs::write(
                dir.join(format!("{index}.log")),
                vec![b'x'; 40 * 1024 * 1024],
            )
            .unwrap();
        }
        enforce_log_retention(&dir);
        let total: u64 = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|entry| entry.metadata().unwrap().len())
            .sum();
        assert!(total <= 100 * 1024 * 1024);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn diagnostic_archive_contains_only_redacted_summary_and_logs() {
        let dir =
            std::env::temp_dir().join(format!("harness-export-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("harness.log.test"),
            "Authorization: Bearer secret-token\nsk-secret-value\n",
        )
        .unwrap();
        let state = DiagnosticsState::new("test-run".into(), dir.clone());
        let archive_path = dir.join("diagnostics.zip");
        export_diagnostics_to(&archive_path, &state, "0.0.0").unwrap();
        let mut archive = zip::ZipArchive::new(fs::File::open(&archive_path).unwrap()).unwrap();
        let names: Vec<_> = archive.file_names().map(str::to_string).collect();
        assert!(names.contains(&"diagnostics.json".to_string()));
        assert!(names
            .iter()
            .all(|name| name == "diagnostics.json" || name.starts_with("logs/")));
        let mut combined = String::new();
        for index in 0..archive.len() {
            archive
                .by_index(index)
                .unwrap()
                .read_to_string(&mut combined)
                .unwrap();
        }
        assert!(!combined.contains("secret-token"));
        assert!(!combined.contains("secret-value"));
        drop(archive);
        fs::remove_dir_all(dir).unwrap();
    }
}
