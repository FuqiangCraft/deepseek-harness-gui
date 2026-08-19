<!-- 
文件说明: 任务工单 01 - Tauri 宿主与 Sidecar 进程生命周期守护
功能描述: 实现 Tauri 桌面应用启动、Node.js Sidecar 子进程拉起、Stdio JSON-RPC 心跳链路与退出清理。
-->

# 01 — Tauri 宿主与 Sidecar 进程生命周期守护

**What to build:**
启动 Tauri 桌面应用后，Rust 宿主自动唤起内置的 Node.js Sidecar 运行时，通过 Stdio 管道建立强类型的 JSON-RPC 2.0 双向通信，并完成双向 Ping-Pong 健康检查。当用户关闭或退出客户端时，Rust 宿主确保子进程及其衍生进程被安全优雅地回收销毁，无残留孤儿进程。

**Blocked by:** None — can start immediately

**Status:** completed

- [x] 初始化 Tauri 2.0 + Rust 核心工程与前端基础脚手架
- [x] 实现 Rust 端的 `SidecarManager`，负责拉起 Node.js Sidecar 并捕获 `stdin`/`stdout`
- [x] 实现基于 Stdio 的轻量行级 NDJSON 帧分包器与 JSON-RPC 2.0 基础通信协议
- [x] 实现 `system.ping` / `system.pong` 心跳请求，在应用启动后完成健康自检
- [x] 注册宿主退出与异常中断钩子，验证客户端关闭时 Sidecar 进程被即时清理

