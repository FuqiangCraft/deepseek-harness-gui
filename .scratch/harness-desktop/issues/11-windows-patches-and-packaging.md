<!--
文件说明: 任务工单 11 - Windows 补丁与独立安装包打包
功能描述: 应用 desktop 关键 Windows 补丁，捆绑 Node 运行时，产出全平台独立安装包。
-->

# 11 — Windows 补丁与独立安装包打包

**What to build:**
应用 desktop 已验证的关键补丁：`dsh-sandbox-windows-acl`（`STARTF_USESHOWWINDOW` +
隐藏窗口，避免 sandbox 命令弹窗）与 `dsh-llm-deepseek`（空 tool-call 生成
`callId: undefined` 修复），经 pnpm overrides/resolutions 打入。重做
`scripts/bundle-sidecar.js`：将独立 Node 运行时与 sidecar dist 捆绑为
External Binary，随 Tauri 产出 Windows NSIS/EXE 与 macOS DMG。升级流程 =
提升锁定版本 + 审计插件 API + 复查补丁。

**Blocked by:** 10 — 企业 DSH 插件模板与下发

**Status:** completed

- [x] 应用 2 个关键补丁（`pnpm-workspace.yaml` 的 `patchedDependencies`，引用 `sidecar/patches/`）：
      `dsh-sandbox-windows-acl`（dwFlags 257 + wShowWindow 0，隐藏 sandbox 命令窗口）、
      `dsh-llm-deepseek`（空 tool-call 不生成 callId: undefined）——已 grep 验证生效
- [x] 重做 `scripts/bundle-sidecar.js`：**单归档方案**（sidecar 3.2 万+ 文件，Tauri 裸目录打包
      在 NSIS 安装后为空）→ `sidecar.tar.gz`（52.8MB）+ 独立 Node 运行时（88MB，v24.16）
- [x] `tauri.conf.json`：`bundle.resources` 只带 `sidecar.tar.gz` + `node/**`；`targets: "nsis"`
      （MSI 因 WiX 对 3.2 万文件卡死已弃用）；lib.rs 首启解压归档到 `%APPDATA%/<id>/sidecar`
      （版本标记自动重解压）+ 探测内置 node
- [x] Windows 安装包构建与端到端验证：`DeepSeek Harness_0.1.0_x64-setup.exe`（81MB），
      全新安装 → 免装 Node → 官方 UI 服务 + webview 连接 ✓
- [x] 升级基线操作手册：`docs/runbooks/upgrade-baseline.md`
