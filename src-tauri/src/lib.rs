// 文件名称: lib.rs
// 功能描述: Tauri 桌面客户端核心逻辑库——极薄宿主：拉起 Node Sidecar 运行官方 DSH Web Host，
// 读取 DSH_PORT 后将主窗口导航到官方 dsh web UI；窗口销毁时回收 Sidecar 进程。
// 内置 sidecar 以单归档（sidecar.tar.gz）随包分发，首启解压到可写 App Data 目录后运行。

pub mod ipc;
pub mod sidecar;

use sidecar::SidecarManager;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{Emitter, Manager};

/// Tauri 全局应用状态结构
pub struct AppState {
    pub sidecar: Arc<SidecarManager>,
}

/// 从 tar.gz 归档解压 sidecar 到目标目录。
/// 使用 `unpack_in` 防止路径穿越（仅信任随包自带的归档，防御性加固）。
/// `+ Send + Sync` 以满足在 `spawn_blocking` 中执行的要求。
fn extract_sidecar(
    archive: &Path,
    dest: &Path,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // 覆盖解压到已有目录在 Windows 上会因 tar 条目覆盖旧文件而失败，
    // 因此先整体清空旧解压，再做干净替换（仅在版本变更/缺失时执行，代价可接受）。
    if dest.exists() {
        std::fs::remove_dir_all(dest)?;
    }
    std::fs::create_dir_all(dest)?;
    let file = std::fs::File::open(archive)?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut tar = tar::Archive::new(decoder);
    for entry in tar.entries()? {
        let mut entry = entry?;
        entry.unpack_in(dest)?;
    }
    Ok(())
}

/// 运行 Tauri 应用程序核心循环
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // 后台初始化 Sidecar 守护进程：不阻塞主线程，窗口先渲染 loading 页保持响应。
            // 首次运行解压归档较慢（数万文件），阻塞主线程会让窗口"未响应"。
            tauri::async_runtime::spawn(async move {
                let resource_dir = app_handle
                    .path()
                    .resource_dir()
                    .unwrap_or_else(|_| PathBuf::from("."));
                let _ = app_handle.emit("startup-progress", "正在初始化引擎组件…");

                // 解压 sidecar 归档到可写 App Data 目录（首启或版本变更时）
                let app_data_dir = app_handle
                    .path()
                    .app_data_dir()
                    .unwrap_or_else(|_| PathBuf::from("."));
                let sidecar_runtime_dir = app_data_dir.join("sidecar");
                let boot_script = sidecar_runtime_dir.join("dist").join("boot.js");
                let archive = resource_dir.join("sidecar.tar.gz");
                let version = app_handle.package_info().version.to_string();
                let version_marker = sidecar_runtime_dir.join(".version");
                let needs_extract = !boot_script.exists()
                    || std::fs::read_to_string(&version_marker)
                        .map(|v| v.trim() != version)
                        .unwrap_or(true);
                if needs_extract && archive.exists() {
                    tracing::info!("Extracting bundled sidecar to {}", sidecar_runtime_dir.display());
                    let _ = app_handle.emit("startup-progress", "正在解压引擎组件（首次启动较慢）…");
                    let dest = sidecar_runtime_dir.clone();
                    let arc = archive.clone();
                    let extract_result =
                        tokio::task::spawn_blocking(move || extract_sidecar(&arc, &dest)).await;
                    match extract_result {
                        Ok(Ok(())) => {
                            let _ = std::fs::write(&version_marker, &version);
                        }
                        Ok(Err(e)) => {
                            let err = format!("解压引擎组件失败: {e}");
                            tracing::error!("{err}");
                            let _ = app_handle.emit("startup-error", err);
                        }
                        Err(e) => {
                            let err = format!("解压任务异常: {e}");
                            tracing::error!("{err}");
                            let _ = app_handle.emit("startup-error", err);
                        }
                    }
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

                match SidecarManager::spawn(node_bin, sidecar_script, working_dir).await {
                    Ok(manager) => {
                        app_handle.manage(AppState {
                            sidecar: manager.clone(),
                        });

                        // 等待 DSH web 端口（DSH_PORT=）并导航主窗口到官方 dsh web UI
                        let nav_window_handle = app_handle.clone();
                        let nav_manager = manager.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Some(port) = nav_manager.wait_for_port().await {
                                let _ = nav_window_handle.emit("startup-progress", "正在加载界面…");
                                let url: tauri::Url =
                                    format!("http://127.0.0.1:{port}").parse().expect("loopback url");
                                if let Some(window) = nav_window_handle.get_webview_window("main") {
                                    let _ = window.navigate(url.clone());
                                }
                                tracing::info!("Navigated webview to {url}");
                            }
                        });

                        tracing::info!("Sidecar manager initialized successfully");
                    }
                    Err(e) => {
                        let err = format!("启动引擎核心失败: {e}");
                        tracing::error!("{err}");
                        let _ = app_handle.emit("startup-error", err);
                    }
                }
            });

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
