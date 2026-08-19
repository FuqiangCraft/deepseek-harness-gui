// 文件名称: main.rs
// 功能描述: Tauri 桌面客户端入口程序，配置控制台日志并拉起应用。

// 阻止在 Windows Release 模式下弹出控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tracing_subscriber::fmt::init();
    harness_desktop_lib::run();
}
