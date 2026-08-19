<!-- 
文件说明: 任务工单 06 - 企业插件模板与全平台打包分发
功能描述: 提供企业级 Cordis 插件脚手架与模板、远程 cordis.yml 配置同步机制及全平台独立安装包打包脚本。
-->

# 06 — 企业插件模板与全平台打包分发

**What to build:**
为团队提供开箱即用的企业级 Cordis 插件开发模板（支持快速接入内网 API、企业私有模型网关、代码合规检查），支持在客户端中配置企业远程配置中心 URL 实现插件清单与 `cordis.yml` 的静默热同步。配置 CI/CD 与打包脚本，将精简 Node 运行时与 Tauri 编译为 Windows (`.msi` / `.exe`) 和 macOS (`.dmg`) 独立安装包。

**Blocked by:** 05 — 工作区沙箱与敏感操作审批门禁

**Status:** completed

- [x] 在 `templates/enterprise-plugin/` 提供标准的企业 Cordis 插件示例与开发指南
- [x] 实现远程配置同步器，支持根据内网 URL 自动拉取最新的团队推荐插件配置
- [x] 编写跨平台打包脚本，将独立 Node.js 二进制随 Tauri 打包为 External Binary
- [x] 在 Windows / macOS 环境下完成一键安装包生成与全链路端到端功能验证

