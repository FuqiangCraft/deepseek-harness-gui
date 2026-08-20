# Changelog

本项目遵循 Keep a Changelog，并在稳定发布后遵循语义化版本。

## [Unreleased]

### Added

- 开源社区规范、可重复工具链和许可证门禁。
- 本地结构化日志、诊断导出、启动性能指标与签名自动更新基础设施。

### Changed

- 正式安装包限定为 Windows NSIS、macOS DMG、Linux AppImage 与 deb。
- 应用标识改为 `io.github.fuqiangchen.harness-agent`。
- 启动页诊断入口改为右下角悬浮面板，正常运行后可继续从系统托盘访问。
- Sidecar 改为由安装器展开并从只读资源目录直接运行，消除首次启动解压等待；内置运行时固定为 Node 22 LTS。

## [0.1.4] - 2026-08-19

### Added

- Tauri 桌面宿主与内置 DeepSeek Harness Sidecar。
