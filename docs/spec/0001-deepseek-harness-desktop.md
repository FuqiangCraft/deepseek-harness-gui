<!-- 
文件说明: DeepSeek Harness 桌面客户端技术设计规约 (Spec)
功能描述: 详细定义基于 Rust + Tauri 的桌面客户端架构、用户故事、实现决策、测试接缝及非目标范围。
-->

# Spec: DeepSeek Harness 桌面客户端 (Rust + Tauri & 插件化扩展)

## Problem Statement

开发团队希望在日常编码工作中全面引入 DeepSeek Harness 智能编程 Agent，但目前面临以下痛点：
1. **使用门槛高**：官方 Harness 主要基于 CLI 与 Node.js 运行时，非前端或非特定环境成员本地部署与配置繁琐，缺乏直观的可视化交互界面。
2. **基线维护难题**：若直接通过二次开发（Fork）修改 Harness 源码以适配企业内部需求，会导致官方基线更新时产生严重的合并冲突与功能失效（Fork Tax）。
3. **安全与管控缺失**：直接运行 CLI 缺乏对本地敏感文件与高危 Shell 指令的权限拦截机制，容易产生误操作风险。

## Solution

构建一个基于 **Rust + Tauri** 的轻量级、开箱即用的跨平台桌面客户端，并严格践行 Harness **“一切皆插件”** 的设计哲学：
1. **零配置分发**：将精简独立的 Node.js 运行时与 Harness 基线打包为 **Bundled Sidecar**，团队全员双击即用。
2. **纯插件化扩展**：企业定制功能（内网认证、专有模型网关、代码合规工具）以独立的 **Cordis Plugin** 形式分发，与官方基线完全解耦，随时无缝升级官方 Harness。
3. **安全沙箱与审查**：通过 **Stdio JSON-RPC** 强类型全双工通信管道连接前端与运行时，内置 **Workspace Jail** 与高危操作 **Approval Gate** 交互拦截，并提供基于 **Monaco Editor** 的高保真代码差异审查能力。

## User Stories

1. 作为团队开发者，我希望下载安装包后无需手动安装 Node.js 或配置全局环境变量，直接打开客户端即可开始使用 Agent。
2. 作为团队开发者，我希望选择本地任意代码仓库作为工作区（Workspace），Agent 只能在该工作区目录下进行文件读取与修改。
3. 作为团队开发者，我希望在对话界面中清晰看到 Agent 的实时流式输出、当前思考过程以及工具调用执行日志。
4. 作为团队开发者，我希望在 Agent 提出代码修改时，通过高保真的 Monaco 差异对比器（Diff Reviewer）审查每一处变更，并支持一键接受或拒绝。
5. 作为团队开发者，我希望当 Agent 尝试执行带有潜在破坏性（如危险 Shell 指令、非临时文件删除）的操作时，客户端自动弹出审批卡片（Approval Gate），在我显式确认前挂起等待。
6. 作为团队管理员，我希望能够统一配置企业内部插件目录与 `cordis.yml`，使团队全员自动加载企业专属模型网关与内部研发工具。
7. 作为团队架构师，我希望在官方 DeepSeek Harness 发布新版本时，仅需更新内置基础依赖包，而团队自研的所有 Cordis 插件依然正常工作。
8. 作为团队开发者，我希望在 Agent 陷入死循环或输出异常时，能够一键中断（Interrupt）当前任务并安全回收子进程状态。
9. 作为团队开发者，我希望能够管理多个历史会话（Agent Session），并能够随时切换查看过往任务的上下文与代码差异快照。
10. 作为团队开发者，我希望客户端在后台静默运行时内存占用低、无本地端口暴露风险，不触发系统防火墙告警。

## Implementation Decisions

### 1. 架构模块划分
* **Harness Host (Rust / Tauri)**：
  * 负责宿主窗口管理、工作区选择对话框、权限门禁逻辑判定。
  * 负责 Node.js Sidecar 子进程的完整生命周期守护（启动、健康监测、优雅终止、异常崩溃清理）。
  * 负责 Stdio 管道数据分帧（NDJSON Framing）与 JSON-RPC 2.0 消息路由器。
* **Sidecar Runtime (Node.js / Cordis)**：
  * 承载官方 `deepseek-harness` 微内核。
  * 暴露 Stdio JSON-RPC 协议通道，将 Agent 内部事件（Token 流、工具调用、审批挂起）转译为 RPC 事件。
  * 实现双层插件加载器（内置基础包 + `~/.harness/plugins/` 及 `.harness/plugins/` 动态扫描）。
* **Frontend Webview (React + TailwindCSS + Monaco)**：
  * `SessionWorkspace`：会话列表与上下文管理。
  * `MessageStream`：流式消息、思考链与工具调用卡片。
  * `DiffReviewer`：基于 Monaco Editor 的 Git 风格差异审查组件。
  * `ApprovalDialog`：敏感操作拦截与授权交互弹窗。

### 2. 核心通信协议契约 (JSON-RPC over Stdio)
* **Rust → Sidecar (Methods)**：
  * `session.start(workspacePath, configOverrides)`
  * `session.sendMessage(sessionId, prompt)`
  * `session.interrupt(sessionId)`
  * `approval.respond(requestId, approved, reason)`
* **Sidecar → Rust (Events & Requests)**：
  * `event.streamToken(sessionId, token)`
  * `event.toolExecuting(sessionId, toolName, params)`
  * `event.fileChanged(sessionId, filePath, diff)`
  * `request.requireApproval(requestId, actionType, details)`

### 3. 安全策略与路径约束
* Rust 宿主对所有入参路径实施 Canonicalize 校验，禁止包含 `../` 越界路径。
* 任何涉及执行 Shell 命令、修改工作区外文件、对外网络请求的操作必须触发 `request.requireApproval`。

## Testing Decisions

### 测试原则与接缝（Test Seams）
坚持测试系统对外行为而非内部实现细节，定义 2 个核心测试接缝：
1. **Seam 1: RPC 协议通信与进程守护接缝（Rust 边界）**
   * **测试方式**：编写 Rust 单元/集成测试，通过 Mock 的 Stdio 管道模拟 Sidecar 响应，验证请求序列化、分帧解析、审批流挂起唤醒及子进程异常崩溃回收逻辑。
2. **Seam 2: Cordis 插件动态载入与事件流转接缝（Node 边界）**
   * **测试方式**：在 Node 环境下测试 `cordis.yml` 动态解析器与自定义企业插件的生命周期，验证外部插件注册后服务能够被 Context 正确发现与调用。

## Out of Scope

1. **远程云端沙箱调度**：初期不实现多机器远程 Docker 容器分发，所有计算聚焦于本地受控环境。
2. **多租户权限系统**：初期权限基于单机用户审批，不接入复杂的企业级 RBAC 远程权限审批流。
3. **自研模型训练与微调面板**：客户端仅负责 Agent 的推理、编排与工具交互，不包含模型训练相关功能。

## Further Notes

* **代码与注释规范**：所有新建或修改的文件必须严格遵守 [AGENT.md](file:///d:/ytong/harness-agent/AGENT.md) 中的中文文件头注释与对应语言文档规范（Rustdoc / JSDoc）。
* **后续对接**：本 Spec 评审通过后，将通过 `/to-tickets` 拆解为带阻塞拓扑关系的独立 Tracer-bullet 工单。
