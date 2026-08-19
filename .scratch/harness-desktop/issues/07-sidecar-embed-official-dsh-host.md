<!--
文件说明: 任务工单 07 - Sidecar 接入官方 DSH Host（桌面对齐嵌入）
功能描述: 用 pnpm + @deepseek-ai/dsh@0.1.0-rc.7 全家桶，在 Sidecar 进程内以库方式 boot() 官方 Host，挂 web profile，起 loopback webserver 并上报端口。
-->

# 07 — Sidecar 接入官方 DSH Host

**What to build:**
Sidecar 切换为 pnpm（hoisted，单一 `@deepseek-ai/cordis` 实例）。以库方式
`boot('dsh', rootConfig, patches, prepare)` 启动官方 Host，挂 **web profile**
（`dsh-base` + `dsh-web-app` 两个 bundle），webserver 绑 `127.0.0.1:<随机端口>`
（loopback HTTP+WS），经 stdout 输出 `DSH_PORT=<port>` 供 Rust 宿主读取。用
`provideCmdline` 提供进程退出能力，用 `resolveDshHome`/`initProfile`/`loadProfile`
管理 `$DSH_HOME/profiles/web`。

**Blocked by:** 01 — Tauri 宿主与 Sidecar 进程生命周期守护

**Status:** in_progress

- [ ] `sidecar/package.json` 切 pnpm + 钉 `0.1.0-rc.7` 全家桶（去掉 electron/pnpm/market/terminal）
- [ ] `sidecar/pnpm-workspace.yaml`：`nodeLinker: hoisted` + `onlyBuiltDependencies`
- [ ] `sidecar/src/boot.ts`：boot + web profile + 随机端口 + `DSH_PORT` 上报 + 崩溃回收
- [ ] 验证官方 dsh web UI 在 `127.0.0.1:<port>` 可访问
