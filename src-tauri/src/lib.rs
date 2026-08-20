// 文件名称: lib.rs
// 功能描述: Tauri 桌面客户端核心逻辑库——极薄宿主：拉起 Node Sidecar 运行官方 DSH Web Host，
// 读取 DSH_PORT 后将主窗口导航到官方 dsh web UI；窗口销毁时回收 Sidecar 进程。
// 内置 sidecar 以单归档（sidecar.tar.gz）随包分发，首启解压到可写 App Data 目录后运行。

pub mod diagnostics;
pub mod ipc;
pub mod sidecar;

use sidecar::SidecarManager;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::UpdaterExt;
use tracing::Instrument;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// Tauri 全局应用状态结构
pub struct AppState {
    pub sidecar: Arc<SidecarManager>,
}

/// 保持非阻塞文件日志写入线程存活至应用退出。
struct LogGuard(#[allow(dead_code)] tracing_appender::non_blocking::WorkerGuard);

/// 构建时生成的 Sidecar 归档清单。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarBundleManifest {
    app_version: String,
    dsh_version: String,
    archive_sha256: String,
    node_version: String,
}

/// 已解压运行时的版本标记。
#[derive(serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SidecarRuntimeMarker {
    app_version: String,
    dsh_version: String,
    archive_sha256: String,
    node_version: String,
}

fn init_logging(app: &tauri::App, run_id: &str) -> PathBuf {
    let log_dir = std::env::var_os("HARNESS_LOG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            app.path()
                .app_log_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("deepseek-harness-logs"))
        });
    if let Err(error) = std::fs::create_dir_all(&log_dir) {
        eprintln!(
            "Failed to create log directory {}: {error}",
            log_dir.display()
        );
    }
    diagnostics::enforce_log_retention(&log_dir);

    let file_appender = tracing_appender::rolling::daily(&log_dir, "harness.log");
    let (file_writer, guard) = tracing_appender::non_blocking(file_appender);
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let subscriber = tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer())
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .json()
                .with_current_span(true)
                .flatten_event(true)
                .with_writer(file_writer),
        );

    if subscriber.try_init().is_ok() {
        app.manage(LogGuard(guard));
        tracing::info!(run_id, component = "host", phase = "logging", log_path = %log_dir.display(), "logging_initialized");
    }
    log_dir
}

/// 检查签名更新并通过原生对话框让用户明确确认安装。
async fn prompt_for_update(app: tauri::AppHandle, quiet_when_current: bool) {
    let run_id = app
        .try_state::<diagnostics::DiagnosticsState>()
        .map(|state| state.run_id.clone())
        .unwrap_or_else(|| "unknown".into());
    match app.updater() {
        Ok(updater) => match updater.check().await {
            Ok(Some(update)) => {
                let version = update.version.clone();
                let prompt_app = app.clone();
                app.dialog().message(format!("发现新版本 {version}。是否下载、验证签名并安装？"))
                    .title("DeepSeek Harness 更新")
                    .buttons(MessageDialogButtons::YesNo)
                    .show(move |accepted| {
                        if accepted {
                            let install_app = prompt_app.clone();
                            tauri::async_runtime::spawn(async move {
                                match update.download_and_install(|_, _| {}, || {}).await {
                                    Ok(()) => install_app.request_restart(),
                                    Err(error) => {
                                        tracing::error!(run_id = %install_app.state::<diagnostics::DiagnosticsState>().run_id, component = "updater", error_chain = %error, "update_install_failed");
                                        install_app.dialog().message(format!("更新安装失败：{error}"))
                                            .title("更新失败").show(|_| {});
                                    }
                                }
                            });
                        }
                    });
            }
            Ok(None) if !quiet_when_current => app
                .dialog()
                .message("当前已是最新版本。")
                .title("检查更新")
                .show(|_| {}),
            Ok(None) => {}
            Err(error) => {
                tracing::warn!(run_id = %run_id, component = "updater", error_chain = %error, "update_check_failed");
                if !quiet_when_current {
                    app.dialog()
                        .message(format!("检查更新失败：{error}"))
                        .title("检查更新")
                        .show(|_| {});
                }
            }
        },
        Err(error) => {
            tracing::warn!(run_id = %run_id, component = "updater", error_chain = %error, "updater_initialization_failed")
        }
    }
}

/// 从 tar.gz 归档解压 sidecar 到目标目录。
/// 使用 `unpack_in` 防止路径穿越（仅信任随包自带的归档，防御性加固）。
/// `+ Send + Sync` 以满足在 `spawn_blocking` 中执行的要求。
fn extract_sidecar(
    archive: &Path,
    dest: &Path,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // 防符号链接/目录穿越：若目标目录已被替换为 symlink/junction，拒绝在它之上解压，
    // 避免 remove_dir_all 顺着链接误删外部目录（现代 std 不跟随链接，这里显式加固）。
    if let Ok(meta) = std::fs::symlink_metadata(dest) {
        if meta.file_type().is_symlink() {
            return Err(format!("refusing to extract over symlink: {}", dest.display()).into());
        }
    }
    std::fs::create_dir_all(dest)?;
    // Unix 上收紧运行目录权限，避免其他本地用户读取解压出的引擎文件。
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dest, std::fs::Permissions::from_mode(0o700))?;
    }
    let file = std::fs::File::open(archive)?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut tar = tar::Archive::new(decoder);
    for entry in tar.entries()? {
        let mut entry = entry?;
        entry.unpack_in(dest)?;
    }
    Ok(())
}

/// 解压到同级临时目录并在成功后替换正式目录，失败时保留原有可用运行时。
fn extract_sidecar_atomic(
    archive: &Path,
    dest: &Path,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let parent = dest.parent().ok_or("sidecar destination has no parent")?;
    std::fs::create_dir_all(parent)?;
    let temp = parent.join(format!("sidecar.extracting-{}", uuid::Uuid::new_v4()));
    let backup = parent.join(format!("sidecar.backup-{}", uuid::Uuid::new_v4()));
    if let Err(error) = extract_sidecar(archive, &temp) {
        let _ = std::fs::remove_dir_all(&temp);
        return Err(error);
    }
    let had_existing = dest.exists();
    if had_existing {
        std::fs::rename(dest, &backup)?;
    }
    if let Err(error) = std::fs::rename(&temp, dest) {
        if had_existing {
            let _ = std::fs::rename(&backup, dest);
        }
        let _ = std::fs::remove_dir_all(&temp);
        return Err(error.into());
    }
    if had_existing {
        let _ = std::fs::remove_dir_all(backup);
    }
    Ok(())
}

/// 计算文件的 SHA-256 十六进制摘要（流式计算，避免整文件载入内存）。
fn sha256_hex(path: &Path) -> std::io::Result<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    Ok(digest.iter().map(|b| format!("{b:02x}")).collect())
}

/// 运行 Tauri 应用程序核心循环
pub fn run() {
    #[cfg(windows)]
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_none() {
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            std::env::set_var(
                "WEBVIEW2_USER_DATA_FOLDER",
                PathBuf::from(local_app_data)
                    .join("io.github.fuqiangchen.harness-agent")
                    .join("webview2"),
            );
        }
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            diagnostics::get_diagnostics_summary,
            diagnostics::copy_diagnostics_summary,
            diagnostics::open_log_directory,
            diagnostics::export_diagnostics,
            diagnostics::export_diagnostics_default,
            diagnostics::check_for_update
        ])
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem, Submenu};
            let open_logs = MenuItem::with_id(app, "diagnostics_open_logs", "打开日志目录", true, None::<&str>)?;
            let export = MenuItem::with_id(app, "diagnostics_export", "导出诊断包", true, None::<&str>)?;
            let copy = MenuItem::with_id(app, "diagnostics_copy", "复制诊断摘要", true, None::<&str>)?;
            let update = MenuItem::with_id(app, "updater_check", "检查更新", true, None::<&str>)?;
            let version = MenuItem::with_id(app, "diagnostics_version", "查看版本", true, None::<&str>)?;
            let help = Submenu::with_items(app, "帮助与诊断", true, &[&open_logs, &export, &copy, &update, &version])?;
            app.set_menu(Menu::with_items(app, &[&help])?)?;
            let run_id = uuid::Uuid::new_v4().to_string();
            let log_dir = init_logging(app, &run_id);
            app.manage(diagnostics::DiagnosticsState::new(run_id.clone(), log_dir.clone()));
            let panic_run_id = run_id.clone();
            std::panic::set_hook(Box::new(move |info| {
                tracing::error!(run_id = %panic_run_id, component = "host", phase = "panic", error_chain = %info, "rust_panic");
            }));
            tracing::info!(run_id = %run_id, component = "host", phase = "startup", app_version = %app.package_info().version, platform = std::env::consts::OS, arch = std::env::consts::ARCH, pid = std::process::id(), log_path = %log_dir.display(), "application_started");
            let app_handle = app.handle().clone();
            let update_handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(8)).await;
                prompt_for_update(update_handle, true).await;
            });

            // 后台初始化 Sidecar 守护进程：不阻塞主线程，窗口先渲染 loading 页保持响应。
            // 首次运行解压归档较慢（数万文件），阻塞主线程会让窗口"未响应"。
            let startup_span = tracing::info_span!("startup_run", run_id = %run_id, component = "host");
            tauri::async_runtime::spawn(async move {
                let startup_started = std::time::Instant::now();
                app_handle.state::<diagnostics::DiagnosticsState>().set_phase("resource_resolution");
                let resource_dir = app_handle
                    .path()
                    .resource_dir()
                    .unwrap_or_else(|_| PathBuf::from("."));
                let _ = app_handle.emit("startup-progress", "正在初始化引擎组件…");

                // 解压 sidecar 归档到可写 App Data 目录（首启或版本变更时）
                let app_data_dir = std::env::var_os("HARNESS_APP_DATA_DIR")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| app_handle.path().app_data_dir().unwrap_or_else(|_| PathBuf::from(".")));
                let sidecar_runtime_dir = app_data_dir.join("sidecar");
                let boot_script = sidecar_runtime_dir.join("dist").join("boot.js");
                let required_boot_package = sidecar_runtime_dir
                    .join("node_modules")
                    .join("@deepseek-ai")
                    .join("dsh-app-boot")
                    .join("package.json");
                let archive = resource_dir.join("sidecar.tar.gz");
                let manifest_path = resource_dir.join("sidecar-manifest.json");
                let version_marker = sidecar_runtime_dir.join(".version");
                let files_ready = boot_script.exists() && required_boot_package.exists();
                let bundle_manifest = std::fs::read_to_string(&manifest_path).ok()
                    .and_then(|raw| serde_json::from_str::<SidecarBundleManifest>(&raw).ok());
                let installed_marker = std::fs::read_to_string(&version_marker).ok()
                    .and_then(|raw| serde_json::from_str::<SidecarRuntimeMarker>(&raw).ok());
                let expected_marker = bundle_manifest.as_ref().map(|manifest| SidecarRuntimeMarker {
                    app_version: manifest.app_version.clone(),
                    dsh_version: manifest.dsh_version.clone(),
                    archive_sha256: manifest.archive_sha256.clone(),
                    node_version: manifest.node_version.clone(),
                });
                let needs_extract = !files_ready || installed_marker.as_ref() != expected_marker.as_ref();

                if archive.exists() && bundle_manifest.is_none() {
                    let err = "Sidecar 清单缺失或格式错误，拒绝启动未验证归档".to_string();
                    app_handle.state::<diagnostics::DiagnosticsState>().set_error(&err);
                    tracing::error!(phase = "archive_validation", "{err}");
                    let _ = app_handle.emit("startup-error", err);
                    return;
                }

                if needs_extract && archive.exists() {
                    app_handle.state::<diagnostics::DiagnosticsState>().set_phase("sidecar_extraction");
                    let extract_started = std::time::Instant::now();
                    tracing::info!("Extracting bundled sidecar to {}", sidecar_runtime_dir.display());
                    let _ = app_handle.emit("startup-progress", "正在解压引擎组件（首次启动较慢）…");
                    let dest = sidecar_runtime_dir.clone();
                    let arc = archive.clone();
                    let expected_hash = bundle_manifest.as_ref().expect("manifest checked").archive_sha256.clone();
                    let extract_result = tokio::task::spawn_blocking(
                        move || -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
                            let actual_hash = sha256_hex(&arc)?;
                            if actual_hash != expected_hash { return Err("sidecar archive SHA-256 mismatch".into()); }
                            extract_sidecar_atomic(&arc, &dest)
                        },
                    )
                    .await;
                    match extract_result {
                        Ok(Ok(())) => {
                            if let Some(marker) = &expected_marker {
                                if let Ok(raw) = serde_json::to_string_pretty(marker) { let _ = std::fs::write(&version_marker, raw); }
                            }
                            tracing::info!(phase = "sidecar_extraction", duration_ms = extract_started.elapsed().as_millis(), "phase_complete");
                        }
                        Ok(Err(e)) => {
                            let err = format!("解压引擎组件失败: {e}");
                            app_handle.state::<diagnostics::DiagnosticsState>().set_error(&err);
                            tracing::error!("{err}");
                            let _ = app_handle.emit("startup-error", err);
                            return;
                        }
                        Err(e) => {
                            let err = format!("解压任务异常: {e}");
                            app_handle.state::<diagnostics::DiagnosticsState>().set_error(&err);
                            tracing::error!("{err}");
                            let _ = app_handle.emit("startup-error", err);
                            return;
                        }
                    }
                }
                if needs_extract && !archive.exists() && !cfg!(debug_assertions) {
                    let err = "安装资源不完整：缺少 sidecar.tar.gz".to_string();
                    app_handle.state::<diagnostics::DiagnosticsState>().set_error(&err);
                    tracing::error!(phase = "archive_validation", "{err}");
                    let _ = app_handle.emit("startup-error", err);
                    return;
                }

                // 多候选路径自适应探测 Sidecar 入口脚本 (boot.js)
                let candidates = [
                    boot_script,                                                       // 解压后的内置 sidecar
                    resource_dir.join("sidecar").join("dist").join("boot.js"),         // 兼容旧布局
                    PathBuf::from("sidecar").join("dist").join("boot.js"),             // dev: 仓库 sidecar
                    PathBuf::from("..").join("sidecar").join("dist").join("boot.js"),
                    std::env::current_dir()
                        .unwrap_or_default()
                        .join("sidecar")
                        .join("dist")
                        .join("boot.js"),
                ];
                let sidecar_script = candidates
                    .into_iter()
                    .find(|p| p.exists())
                    .unwrap_or_else(|| PathBuf::from("sidecar/dist/boot.js"));

                let working_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

                // 跨平台探测捆绑的 Node 运行时（Windows: node.exe, macOS/Linux: node）
                let node_bin_name = if cfg!(windows) { "node.exe" } else { "node" };
                let node_candidates = [
                    resource_dir.join("node").join(node_bin_name),
                    resource_dir.join("resources").join("node").join(node_bin_name),
                    resource_dir.join("resources").join(node_bin_name),
                    PathBuf::from("src-tauri").join("resources").join("node").join(node_bin_name),
                    PathBuf::from("node").join(node_bin_name),
                ];
                let node_bin = node_candidates
                    .into_iter()
                    .find(|p| p.exists())
                    .unwrap_or_else(|| PathBuf::from("node"));

                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if let Ok(metadata) = std::fs::metadata(&node_bin) {
                        let mut perms = metadata.permissions();
                        perms.set_mode(0o755);
                        let _ = std::fs::set_permissions(&node_bin, perms);
                    }
                }

                tracing::info!("Using node binary: {}", node_bin.display());
                tracing::info!("Sidecar script: {}", sidecar_script.display());

                let _ = app_handle.emit("startup-progress", "正在启动引擎核心…");
                app_handle.state::<diagnostics::DiagnosticsState>().set_phase("sidecar_spawn");
                let spawn_started = std::time::Instant::now();

                match SidecarManager::spawn(node_bin, sidecar_script, working_dir, &run_id).await {
                    Ok(manager) => {
                        tracing::info!(phase = "sidecar_spawn", duration_ms = spawn_started.elapsed().as_millis(), "phase_complete");
                        app_handle.manage(AppState {
                            sidecar: manager.clone(),
                        });

                        // 等待 DSH web 端口（DSH_PORT=）并导航主窗口到官方 dsh web UI
                        let nav_window_handle = app_handle.clone();
                        let nav_manager = manager.clone();
                        tauri::async_runtime::spawn(async move {
                            nav_window_handle.state::<diagnostics::DiagnosticsState>().set_phase("web_server_ready");
                            let port_started = std::time::Instant::now();
                            match nav_manager
                                .wait_for_port(std::time::Duration::from_secs(60))
                                .await
                            {
                                Ok(port) => {
                                    let _ = nav_window_handle.emit("startup-progress", "正在加载界面…");
                                    let url: tauri::Url = format!("http://127.0.0.1:{port}")
                                        .parse()
                                        .expect("loopback url");
                                    if let Some(window) = nav_window_handle.get_webview_window("main") {
                                        let _ = window.navigate(url.clone());
                                    }
                                    nav_window_handle.state::<diagnostics::DiagnosticsState>().set_phase("navigation_complete");
                                    tracing::info!(phase = "web_server_ready", duration_ms = port_started.elapsed().as_millis(), "web_server_ready");
                                    tracing::info!(phase = "navigation_complete", duration_ms = startup_started.elapsed().as_millis(), "navigation_complete");
                                }
                                Err(error) => {
                                    let message = format!(
                                        "引擎启动失败: {error}。详细日志: {}",
                                        log_dir.display()
                                    );
                                    nav_window_handle.state::<diagnostics::DiagnosticsState>().set_error(&message);
                                    tracing::error!("{message}");
                                    let _ = nav_window_handle.emit("startup-error", message);
                                }
                            }
                        });

                        tracing::info!("Sidecar manager initialized successfully");
                    }
                    Err(e) => {
                        let err = format!("启动引擎核心失败: {e}");
                        app_handle.state::<diagnostics::DiagnosticsState>().set_error(&err);
                        tracing::error!("{err}");
                        let _ = app_handle.emit("startup-error", err);
                    }
                }
            }.instrument(startup_span));

            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            let state = app.state::<diagnostics::DiagnosticsState>();
            match id {
                "diagnostics_open_logs" => { let _ = diagnostics::open_log_directory_path(&state.log_dir); }
                "diagnostics_export" => {
                    let destination = state.log_dir.join(format!("diagnostics-{}.zip", state.run_id));
                    match diagnostics::export_diagnostics_to(&destination, state.inner(), &app.package_info().version.to_string()) {
                        Ok(path) => app.dialog().message(format!("诊断包已导出到：\n{path}")) .title("导出完成").show(|_| {}),
                        Err(error) => app.dialog().message(format!("导出失败：{error}")) .title("导出失败").show(|_| {}),
                    }
                }
                "diagnostics_copy" => {
                    if let Ok(summary) = serde_json::to_string_pretty(&state.summary(&app.package_info().version.to_string())) {
                        let _ = app.clipboard().write_text(summary);
                    }
                }
                "updater_check" => {
                    let handle = app.clone();
                    tauri::async_runtime::spawn(async move { prompt_for_update(handle, false).await; });
                }
                "diagnostics_version" => app.dialog().message(format!("DeepSeek Harness {}\nrun_id: {}", app.package_info().version, state.run_id))
                    .title("版本信息").show(|_| {}),
                _ => {}
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app_handle = window.app_handle();
                if let Some(state) = app_handle.try_state::<AppState>() {
                    let sidecar = state.sidecar.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = sidecar.shutdown().await;
                    });
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
