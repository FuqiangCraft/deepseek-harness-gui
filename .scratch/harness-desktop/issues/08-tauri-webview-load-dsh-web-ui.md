<!--
文件说明: 任务工单 08 - Tauri webview 加载官方 dsh web UI，宿主瘦身
功能描述: Rust 宿主读取 sidecar 端口，主窗口导航到 loopback 加载官方 dsh web UI；退役自定义 React 前端与自定义 RPC 桥。
-->

# 08 — Tauri webview 加载官方 dsh web UI

**What to build:**
Rust 宿主在 sidecar 上报 `DSH_PORT` 后，将主 WebviewWindow 导航到
`http://127.0.0.1:<port>` 加载官方 dsh web UI。退役自定义前端
（`src/App.tsx`、Monaco Diff、审批卡片）与自定义 Stdio JSON-RPC 会话/审批/差异桥
（对应 Rust 侧 14 个 IPC 命令）。SidecarManager 进程守护与健康检查保留。安全配置
（CSP、webview 远程 loopback 访问、导航白名单）按 Tauri 语义适配。

**Blocked by:** 07 — Sidecar 接入官方 DSH Host

**Status:** completed

- [x] Rust 读取 `DSH_PORT` 行，`webview.navigate()` 到 loopback URL
- [x] 退役全部自定义 IPC 命令（`commands.rs` 归档至 `legacy/rust-commands/`），移除 `invoke_handler`
- [x] 自定义 React 前端归档至 `legacy/react-frontend/`；`index.html` 改为静态启动页（Vite 构建 `dist/`）；`frontendDist` 保留为启动页
- [x] 移除死掉的 RPC 事件转发循环；`SidecarManager.shutdown()` 去掉 10s RPC 停机握手，直接终止进程
- [x] 验证窗口加载官方 UI（webview 与引擎 3 条 ESTABLISHED 连接）；窗口关闭回收 sidecar

**遗留观察（非阻塞）：**
- 开发期多次中断 `tauri dev` 可能遗留孤儿 node 进程（每个 dsh sidecar 约 150-200MB），后续可在打包期统一做孤儿进程清理。
- `src-tauri/resources/sidecar/dist/` 仍为仿制时代旧产物，待工单 #11（打包）重做。
