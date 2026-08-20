// 文件名称: lib.rs
// 功能描述: Tauri 桌面客户端核心逻辑库——极薄宿主：拉起 Node Sidecar 运行官方 DSH Web Host，
// 读取 DSH_PORT 后将主窗口导航到官方 dsh web UI；窗口销毁时回收 Sidecar 进程。
// 内置 Sidecar 由安装器展开到只读资源目录，宿主直接使用随包 Node 22 LTS 原地运行。

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

/// 从 WebView 入口触发带用户确认的手动更新检查。
#[tauri::command]
async fn manual_check_for_update(app: tauri::AppHandle) {
    prompt_for_update(app, false).await;
}

/// 处理托盘诊断菜单动作，确保主 WebView 导航后仍可访问诊断能力。
fn handle_diagnostics_menu(app: &tauri::AppHandle, id: &str) {
    let state = app.state::<diagnostics::DiagnosticsState>();
    match id {
        "diagnostics_open_logs" => {
            let _ = diagnostics::open_log_directory_path(&state.log_dir);
        }
        "diagnostics_export" => {
            let destination = state
                .log_dir
                .join(format!("diagnostics-{}.zip", state.run_id));
            match diagnostics::export_diagnostics_to(
                &destination,
                state.inner(),
                &app.package_info().version.to_string(),
            ) {
                Ok(path) => app
                    .dialog()
                    .message(format!("诊断包已导出到：\n{path}"))
                    .title("导出完成")
                    .show(|_| {}),
                Err(error) => app
                    .dialog()
                    .message(format!("导出失败：{error}"))
                    .title("导出失败")
                    .show(|_| {}),
            }
        }
        "diagnostics_copy" => {
            if let Ok(summary) = serde_json::to_string_pretty(
                &state.summary(&app.package_info().version.to_string()),
            ) {
                let _ = app.clipboard().write_text(summary);
            }
        }
        "updater_check" => {
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                prompt_for_update(handle, false).await;
            });
        }
        "diagnostics_version" => app
            .dialog()
            .message(format!(
                "DeepSeek Harness {}\nrun_id: {}",
                app.package_info().version,
                state.run_id
            ))
            .title("版本信息")
            .show(|_| {}),
        _ => {}
    }
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
            diagnostics::check_for_update,
            manual_check_for_update
        ])
        .setup(|app| {
            let run_id = uuid::Uuid::new_v4().to_string();
            let log_dir = init_logging(app, &run_id);
            app.manage(diagnostics::DiagnosticsState::new(run_id.clone(), log_dir.clone()));

            // 托盘菜单不占用窗口内容区域，并在 WebView 导航后持续提供诊断入口。
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::TrayIconBuilder;
            let open_logs = MenuItem::with_id(
                app,
                "diagnostics_open_logs",
                "打开日志目录",
                true,
                None::<&str>,
            )?;
            let export = MenuItem::with_id(
                app,
                "diagnostics_export",
                "导出诊断包",
                true,
                None::<&str>,
            )?;
            let copy = MenuItem::with_id(
                app,
                "diagnostics_copy",
                "复制诊断摘要",
                true,
                None::<&str>,
            )?;
            let update =
                MenuItem::with_id(app, "updater_check", "检查更新", true, None::<&str>)?;
            let version = MenuItem::with_id(
                app,
                "diagnostics_version",
                "查看版本",
                true,
                None::<&str>,
            )?;
            let tray_menu =
                Menu::with_items(app, &[&open_logs, &export, &copy, &update, &version])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("DeepSeek Harness · 帮助与诊断")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    handle_diagnostics_menu(app, event.id().as_ref());
                });
            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }
            tray.build(app)?;

            let panic_run_id = run_id.clone();
            std::panic::set_hook(Box::new(move |info| {
                tracing::error!(run_id = %panic_run_id, component = "host", phase = "panic", error_chain = %info, "rust_panic");
            }));
            tracing::info!(run_id = %run_id, component = "host", phase = "startup", app_version = %app.package_info().version, platform = std::env::consts::OS, arch = std::env::consts::ARCH, pid = std::process::id(), log_path = %log_dir.display(), "application_started");
            let app_handle = app.handle().clone();
            // 后台初始化 Sidecar 守护进程：不阻塞主线程，窗口先渲染 loading 页保持响应。
            let startup_span = tracing::info_span!("startup_run", run_id = %run_id, component = "host");
            tauri::async_runtime::spawn(async move {
                let startup_started = std::time::Instant::now();
                app_handle.state::<diagnostics::DiagnosticsState>().set_phase("resource_resolution");
                let resource_dir = app_handle
                    .path()
                    .resource_dir()
                    .unwrap_or_else(|_| PathBuf::from("."));
                let _ = app_handle.emit("startup-progress", "正在初始化引擎组件…");

                // Sidecar 由安装器随应用展开，运行时直接从只读资源目录启动。
                let bundled_sidecar_dir = resource_dir.join("sidecar");
                let boot_script = bundled_sidecar_dir.join("dist").join("boot.js");
                let required_boot_package = bundled_sidecar_dir
                    .join("node_modules")
                    .join("@deepseek-ai")
                    .join("dsh-app-boot")
                    .join("package.json");
                if (!boot_script.exists() || !required_boot_package.exists())
                    && !cfg!(debug_assertions)
                {
                    let err = "安装资源不完整：缺少可运行的 Sidecar 生产依赖".to_string();
                    app_handle.state::<diagnostics::DiagnosticsState>().set_error(&err);
                    tracing::error!(phase = "resource_validation", "{err}");
                    let _ = app_handle.emit("startup-error", err);
                    return;
                }

                // 多候选路径自适应探测 Sidecar 入口脚本 (boot.js)
                let candidates = [
                    boot_script,                                                       // 安装器展开的内置 sidecar
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

                let working_dir = sidecar_script
                    .parent()
                    .and_then(Path::parent)
                    .map(Path::to_path_buf)
                    .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

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
                                    let startup_duration_ms = startup_started.elapsed().as_millis();
                                    tracing::info!(phase = "navigation_complete", duration_ms = startup_duration_ms, "navigation_complete");
                                    // CI 冒烟测试使用同步就绪标记，避免强制终止进程时异步日志尚未刷盘。
                                    if let Some(path) = std::env::var_os("HARNESS_SMOKE_READY_FILE") {
                                        let payload = serde_json::json!({ "durationMs": startup_duration_ms });
                                        let _ = std::fs::write(path, payload.to_string());
                                    }
                                    let update_handle = nav_window_handle.clone();
                                    tauri::async_runtime::spawn(async move {
                                        tokio::time::sleep(std::time::Duration::from_secs(15)).await;
                                        prompt_for_update(update_handle, true).await;
                                    });
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
