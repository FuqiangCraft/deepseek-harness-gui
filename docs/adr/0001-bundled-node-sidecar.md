<!-- 
文件说明: 架构决策记录 (ADR 0001)
功能描述: 确立以内置独立 Node.js 运行时作为 Tauri Sidecar 的分发策略。
-->

# ADR 0001: 内置独立 Node.js 运行时 (Bundled Sidecar)

## 状态
已接受 (Accepted)

## 背景与决策
DeepSeek Harness 核心基于 Node.js 与 Cordis 插件体系。为避免团队成员因本地 Node.js 版本差异导致的运行问题，并实现开箱即用的交付体验，我们决定将独立精简版 Node.js 运行时打包为 Tauri External Binary（Sidecar），而非依赖宿主系统的全局 Node 环境。

## 权衡与后果
* **优势**：消除用户端环境依赖，保证运行环境的确定性与一致性。
* **代价**：安装包增大约 30MB~50MB，需要在 CI/CD 打包流水线中配置多平台（Windows / macOS / Linux）Sidecar 二进制构建脚本。
