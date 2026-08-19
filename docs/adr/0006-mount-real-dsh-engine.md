<!--
文件说明: 架构决策记录 (ADR 0006)
功能描述: 确立将官方 @deepseek-ai/dsh 引擎进程内挂载进 Sidecar、企业能力插件化、固定版本基线升级策略的集成决策。
-->

# ADR 0006: 挂载真实 deepseek-harness 引擎（路径3 插件化集成）

## 状态
已接受 (Accepted) — 2026-08-19 经团队决策确认：保留 Tauri+Rust 宿主，首个里程碑为真实引擎端到端。

## 背景与决策

调研确认（[deepseek-harness-integration.md](../research/deepseek-harness-integration.md)）：
`deepseek-harness` 是 DeepSeek 官方开源 agent 引擎，npm 包 `@deepseek-ai/dsh@0.1.0-rc.7`，
TypeScript + Cordis monorepo，自述 "Everything is a Plugin."，无特权核心，扩展点为 `ctx.*` 服务与
`session/*`、`agent/*` 事件域。官方明示 RC 期存在破坏性兼容变更。社区 desktop（Electron）正是
"固定版本基线 + 少量 patch + 桌面壳作为 DSH 插件"的范本。

当前项目的问题：Sidecar 内是**仿制引擎**——`runAgentLoop` 硬编码模拟输出、`base-tools.ts` 为自研
mock 工具集，未挂载真实引擎。架构骨架（Rust 宿主 / Node Sidecar）真实，但被仿制层占位。

决策（三条路径中的**路径3：插件/适配器**，嵌入模型**桌面对齐**——参考社区 desktop 的
"官方 DSH Web Host 直接装入"做法）：
1. **桌面对齐嵌入**：Sidecar 以库方式 `boot()` 官方 Host（`@deepseek-ai/dsh-app-boot`），挂
   **web profile**（`dsh-base` + `dsh-web-app`），webserver 绑 `127.0.0.1:<随机端口>`
   （loopback HTTP+WS）；Tauri webview **直接导航到该 URL 加载官方 dsh web UI**，与 desktop
   的 BrowserWindow 加载同源 web UI 等价。全部 `@deepseek-ai/*` 钉 `0.1.0-rc.7`。
2. **宿主瘦身**：Rust 宿主降级为**进程管理器 + 原生安全壳**（sidecar 生命周期守护、webview
   窗口、原生目录选择等）。自定义 Stdio JSON-RPC 的会话/审批/差异桥对 agent 主面**退役**
   ——官方 web UI 经 loopback 直接与引擎通信，无需中转。
3. **能力插件化**：企业功能（模型网关、认证、内网工具）作为 **dsh Cordis 插件**
   （`ctx.tools.register`、`ctx.agents`、事件域）挂到引擎；审批与沙箱由引擎内建
   （`dsh-user-approval` / `dsh-permission-presets` / `dsh-sandbox`）。企业插件随
   `$DSH_HOME/profiles/` 的 bundle/patch 机制下发。
4. **删除仿制**：`runAgentLoop` 假循环、mock `base-tools`、自定义 `PluginLoader`、自定义
   session/approval/diff RPC handlers 全部退役，由官方 Loader 插件树与 web UI 取代。
5. **固定版本基线 + patches**：钉 `0.1.0-rc.7`；Windows 专属补丁（`dsh-sandbox-windows-acl`
   的 SHOWNOACTIVATE 修复、`dsh-llm-deepseek` 的空 tool-call 修复）经 pnpm
   overrides/resolutions 应用；升级 = 提升锁定版本 + 审计插件 API 变更。禁止 fork 上游。

## 权衡与后果

* **优势**：企业定制与官方基线完全解耦，升级成本收敛到契约层；官方 web UI 与引擎能力
  （agent loop/工具/审批/沙箱/会话）全量复用，不再自造；保留 dsh 插件生态。
* **代价**：自定义 React 前端与自定义 RPC 桥被官方 UI 取代（丧失自有界面）；需要
  **Node ≥ 22.19**；全进程必须只有**一份 `@deepseek-ai/cordis`** 实例（peer 依赖重，Sidecar
  需从 npm 切换为 pnpm + hoisted 布局）；Windows 上 koffi（sandbox ACL FFI）需可构建；
  引擎故障与 Sidecar 进程同生命周期，需宿主侧崩溃回收兜底。

## 备选方案

* **路径1 Fork 二次开发**：拒绝。RC 期每版破坏兼容，rebase 成本最高；"无特权核心可 patch"
  意味着 fork 即失去插件生态。
* **路径2 纯套壳（官方 SDK/ACP/HTTP）**：留作兜底。若将来要求完全自有体验外壳且不愿承担
  RC API 变动维护，退回 SDK/ACP/loopback HTTP；但会放弃引擎内建的 agent loop、工具、审批、
  沙箱等能力。**不 fork。**
