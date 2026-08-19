# DeepSeek Harness 与 Desktop 客户端调研报告

> 调研日期 2026-08-19。结论均基于第一手来源（官方 README/源码/文档/Agent Notes），每条附 URL；无法确认处已标注。

## A. 核心架构与设计理念

**定位**：DeepSeek Harness（`dsh`）是 DeepSeek AI 开发的开源 agent harness（智能体运行时引擎），兼具 CLI 启动器、可嵌入框架（Host/Client 双面）、插件平台三重身份。自述 "Everything is a Plugin."，处于 developer preview（0.1.0-rc.7，已发布 npm），官方明示"THERE WILL BE COMPATIBILITY-BREAKING CHANGES"。分发为 npm 包 `@deepseek-ai/dsh`。
来源：[README](https://github.com/deepseek-ai/deepseek-harness/blob/master/README.md)

**"一切皆插件"真实且无特权核心**。架构文档原文："Every part of the product is a plugin, including the model adapter, the tool registry, the session log, and the agent loop itself… There is no privileged core to patch"。底层由 [Cordis](https://github.com/cordiverse/cordis) 驱动（插件贡献 service/类型化事件/可逆 effect）。插件形态有四种：① npm 包（`@deepseek-ai/dsh-*`，Cordis `apply(ctx, config)` 插件）；② **bundle**（可分发、可 patch 的配置层，`cordis.patch.yml`）；③ **profile**（按序堆叠 bundle 的命名组合，存于 `$DSH_HOME/profiles/`）；④ **hooks**（桥接 Claude Code/Codex 外部 shell-hook 协议）。扩展点为 `ctx.*` 服务键（`ctx.llm`/`ctx.tools`/`ctx.fs`/`ctx.sandbox`/`ctx.shell`…）与事件域（`session/*`、`agent/*`、`fs/*`、`tools/*`）。
插件发现走 GitHub topic `dsh-plugin` 与社区市场（desktop 收录的 1024Store 目录已收录 4120 个插件）。
来源：[docs/architecture.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)、[packages/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/README.md)、[packages/hooks/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/hooks/README.md)

**宿主形态**：仓库以 Host/Client 两套 tsconfig 聚合严格分离。宿主有三：`dsh` CLI（profile 启动器）；`dsh web` Web Host（packages/host，HTTP+WebSocket 服务浏览器 UI）；`dsh --profile headless` 一次性 runner（不开任何监听端口）。另有 Linux 沙箱原生组件 `native/landlock-run`（bwrap/Landlock）。
来源：[apps/cli/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/README.md)、[packages/bundle/headless/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/headless/README.md)

**与官方客户端 / Claude Code 关系**：`dsh` 是 DeepSeek 官方开源 agent 引擎，定位类似 Claude Code，但**是独立产品，非 Claude Code 的包装**——仅以 `hooks-claude-code`/`hooks-codex` 桥接兼容两类外部 hook 协议。官方聊天 App 是否基于 dsh 构建，**无法确认**。
来源：[packages/hooks/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/hooks/README.md)

## B. 如何作为库/引擎被宿主集成

**官方文档化了嵌入方式**：架构文档明确 "Add UI or editor integration: drive `ctx.agents` and render from `session/event`"，并提供多套可复用协议：

① **TS SDK**（packages/sdk）：JSON-RPC over stdio，官方进程外驱动（protocol + TypeScript 客户端 + server 插件）；② **Python SDK**（pip 包 `deepseek-harness-sdk`）：自带打包运行时、**无需系统 Node.js**；③ **ACP**（packages/acp）：Agent Client Protocol over JSON-RPC stdio，自动化专用（建 agent、发 prompt、收最终文本、按策略放行权限，不暴露 UI/文件/MCP）；④ **Web Host**（host+client）：loopback HTTP+WebSocket 载波，浏览器端不直连 Electron；⑤ **Typert RPC**（api/gateway+remotes）：类型化 `@Remote` 调用面；⑥ **Hooks** 桥。
无 gRPC/REST 对外接口；**MCP 是 agent 消费的客户端能力（packages/mcp），非宿主集成面**，ACP 亦不对外暴露 MCP。
来源：[packages/sdk/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/README.md)、[packages/acp/acp/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/README.md)、[docs/user/guide/python-sdk.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/python-sdk.md)

**集成边界**：引擎提供 agent loop（turn/step 状态机）、工具注册与守卫执行、会话状态（append-only `SessionEvent` 日志 + JSONL/SQLite 持久化）、上下文/prompt 组装、模型适配、权限审批、沙箱与子进程、设置/凭据。宿主只需实现 UI、原生窗口/托盘、存储根与打包——UI 亦可复用官方 `dsh-web-app` bundle（经 loopback 载波）。
来源：[docs/architecture.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)

**分层确认**：harness 是**可被 UI 宿主复用的 headless 引擎**——headless bundle 无端口，SDK/ACP 允许外部进程驱动，Web Host 又是内建可复用 UI 面；Desktop 客户端正是"极薄宿主"的实证。

## C. deepseek-harness-desktop 客户端

**技术栈**：**Electron**（Electron Builder + `app.asar`；node-pty/Windows ACL 等原生依赖放 `app.asar.unpacked`），TypeScript，外层 Yarn 4 workspace；上游 `deepseek-harness/` 以 **git submodule 固定到官方精确 commit**，上游保留自身 pnpm workspace。安装包：Windows x64 NSIS + macOS Universal DMG；有 `patches/` 对少数上游包打 Windows 专属补丁。
来源：[docs/architecture.md](https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/docs/architecture.md)、[.gitmodules](https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/.gitmodules)

**架构分层与调用方式**："DSH Desktop 是一个薄的 Electron 宿主"。Electron main 进程内**以库形式启动官方 DSH Host（Cordis root）**，Host 把 agent/model/tool/session/settings/webServer/subprocess 挂到 loopback HTTP+WebSocket（127.0.0.1 随机端口），沙箱 BrowserWindow 加载同源 Web UI；**无自造 renderer IPC 插件系统，不向页面暴露 Electron API**。桌面壳自身是合法 DSH 插件（`dsh-plugin-desktop`），经官方 Cordis 组合路径提供 window/tray/profile/terminal/update；插件增删改走打包 `dsh plugin` CLI + 内置 pnpm。
来源：[dsh-plugin-desktop/README.md](https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/dsh-plugin-desktop/README.md)

**官方性与活跃度**：**非官方**。README 多次声明"社区维护的开源项目，并非 DeepSeek 官方产品""未获得其背书"。MIT 许可。约 13.7k star，创建 2026-08-13，最近 push 2026-08-18，PR 至 #306+，极活跃但项目极新。另有 `dsh-community-fabric`（社区插件契约草案）、`dsh-community-market`（插件市场）。值得注意的是，Desktop 对第三方插件**只暴露 `desktopProfiles`/`desktopPnpm` 两个公开 Cordis service**，Electron 窗口/托盘能力为 launcher 私有，第三方插件无法直接触碰原生 API——这界定了"桌面能力插件化"的安全边界。
来源：[README](https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/README.md)

**相对直接跑 CLI 多出的能力**：原生窗口/托盘/内置终端/自动更新；多 profile 管理（切换=有序重启 + last-known-good 回滚）；免装 Node.js（打包运行时+内置 pnpm）；原生目录选择器；Windows ACL 沙箱适配；日志/崩溃导出；插件市场；手机远程控制（"即将推出"）。
来源：[README](https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/README.md)

## D. 三者衔接与三条路径对比

desktop 项目本身即**路径 3 的现实范本**，其 pinned-upstream Agent Note 明确拒绝了 fork/随文件携带/vendor 子树/源链接等方案，选择"git submodule 固定官方源码 + 运行时从 npm 解析公开包（0.1.0-rc.7）+ 桌面壳作为 DSH 插件 + 少量 Windows 专属 patch"。

- **路径 1 fork 二次开发**：升级基线成本最高（RC 期每版本破坏兼容，rebase 反复解冲突）；官方支持度无（"无特权核心可 patch"），fork 即失插件生态；侵入 agent loop，耦合最重；需持续移植补丁，维护量最大。
- **路径 2 纯套壳**：走 SDK/ACP/HTTP 协议层，升级成本低、耦合低；但拿不到 UI/插件生态，会话/UI/权限全自建，等于重造引擎。
- **路径 3 插件/适配器（推荐）**：复用官方扩展点，把客户端能力做成 Cordis 插件挂到宿主引擎；扩展点是第一方文档化契约，支持度最高，desktop 已验证可行；升级=更新固定版本基线+审计插件 API 变更，维护集中于契约层。

**推荐路径 3**。上游把"无特权核心、一切可替换"作为一等设计且明示 RC 期破坏兼容，fork 此时机最不可持续；纯套壳又放弃引擎内建能力。路径 3 可照搬 desktop"固定版本基线 + 少量 patch + 契约依赖"模式起步。若确需完全自有体验外壳且不愿承担 RC API 变动维护，退而选路径 2（SDK/ACP/loopback HTTP），但不要 fork。
来源：[pinned-upstream Agent Note](https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/.agents/notes/implemented/process/2026-08-15-pinned-upstream-and-isolated-yarn-workspace.md)、[docs/architecture.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)

## 附：关键事实速查

上游 `deepseek-ai/deepseek-harness`：TypeScript/monorepo/MIT，约 160k star，官方开源，npm `@deepseek-ai/dsh@0.1.0-rc.7`。桌面 `anywhere-labs/deepseek-harness-desktop`：Electron/TypeScript/MIT，约 13.7k star，**社区非官方**，npm `dsh-plugin-desktop@2.0.0`，固定上游 rc.7 子模块。可复用接口：TS SDK、Python SDK、ACP、loopback HTTP+WS、Typert RPC、Claude Code/Codex hooks 桥。
