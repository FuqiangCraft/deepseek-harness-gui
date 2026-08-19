<!-- 
文件说明: 项目领域术语表与统一语言定义 (Ubiquitous Language)
功能描述: 记录 DeepSeek Harness 桌面客户端核心领域概念与专用名词边界。
-->

# DeepSeek Harness Desktop

DeepSeek Harness 桌面客户端的统一领域模型与术语定义。

## 核心术语 (Language)

**Harness Host**:
由 Rust + Tauri 驱动的桌面宿主进程，负责管理窗口生命周期、Sidecar 进程守护及引擎安全隔离。
_Avoid_: App Core, Shell Main

**Sidecar Runtime**:
随客户端安装包一同内置分发的独立 Node.js 运行时，用于承载官方 DeepSeek Harness (dsh) 引擎。
_Avoid_: Backend Server, Node Service

**Cordis Plugin**:
符合 DeepSeek Harness / Cordis 规范的模块化功能扩展包，通过声明式依赖与可逆生命周期挂载到引擎上下文。
_Avoid_: Addon, Extension, Hook

**DSH Web UI**:
官方 dsh-web-app Profile 提供的交互界面，由 Sidecar 在本地 Loopback 端口提供，宿主导航 WebView 加载。
_Avoid_: Chat Thread, Frontend

**Startup Loading**:
宿主在引擎就绪前展示的加载页，订阅启动进度事件并在 `DSH_PORT=` 就绪后淡出导航到 DSH Web UI。
_Avoid_: Splash Screen

**Sidecar Watchdog**:
进程生命周期防护：Windows Job Object (KILL_ON_JOB_CLOSE) 与 stdin/stdout 管道断开双保险，杜绝孤儿 Sidecar。
_Avoid_: Process Guard

**Loopback Web Server**:
DSH 引擎绑定的 `127.0.0.1:<随机端口>` Web 服务。仅本机可访问、不对公网暴露；注意本机任意进程均可连接该端口。
_Avoid_: Remote Server, Public Endpoint
