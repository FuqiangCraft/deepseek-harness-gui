<!-- 
文件说明: 任务工单 02 - Sidecar 微内核与双层插件动态加载器
功能描述: 实现基于 Cordis 的 Harness 微内核运行时，支持内置基线插件与外部目录动态插件扫描加载。
-->

# 02 — Sidecar 微内核与双层插件动态加载器

**What to build:**
Sidecar 运行时启动时，通过 Cordis 微内核初始化全局 Context，读取默认的 `cordis.yml` 加载内置基线 Harness 核心组件（模型适配器、基础文件工具），并自动扫描用户主目录（`~/.harness/plugins/`）及工作区（`.harness/plugins/`）下的企业外部插件。外部插件注册的服务与工具能够被全局 Context 自动发现并挂载。

**Blocked by:** 01 — Tauri 宿主与 Sidecar 进程生命周期守护

**Status:** completed

- [x] 搭建 Node.js Sidecar 运行时的 Cordis 微内核基础上下文
- [x] 集成官方 `deepseek-harness` 基础组件作为只读内置插件层
- [x] 实现 `PluginLoader` 动态目录扫描器，解析外部插件清单并动态 `import`
- [x] 验证在外部目录放置自定义插件时，该插件成功向 Context 注册新工具并生效
- [x] 暴露 RPC 方法 `plugins.list`，供 Rust 宿主与前端查询当前已激活的插件列表

