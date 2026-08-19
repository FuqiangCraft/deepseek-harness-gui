<!-- 
文件说明: 项目领域术语表与统一语言定义 (Ubiquitous Language)
功能描述: 记录 DeepSeek Harness 客户端及其插件系统相关的核心领域概念与专用名词边界。
-->

# DeepSeek Harness Desktop

DeepSeek Harness 桌面客户端及企业插件生态系统的统一领域模型与术语定义。

## 核心术语 (Language)

**Harness Host**:
由 Rust + Tauri 驱动的桌面宿主进程，负责管理窗口生命周期、安全沙箱及 Sidecar 进程守护。
_Avoid_: App Core, Shell Main

**Sidecar Runtime**:
随客户端安装包一同内置分发的独立 Node.js 运行时，用于承载 DeepSeek Harness 及 Cordis 插件微内核。
_Avoid_: Backend Server, Node Service

**Cordis Plugin**:
符合 DeepSeek Harness / Cordis 规范的模块化功能扩展包，通过声明式依赖与可逆生命周期挂载到全局上下文。
_Avoid_: Addon, Extension, Hook

**IPC Channel**:
基于 JSON-RPC 2.0 协议构建于标准输入输出（Stdio）之上的强类型全双工通信管道，用于 Rust 宿主与 Sidecar 运行时的数据交换。
_Avoid_: Socket Bridge, HTTP Pipe

**Plugin Manifest**:
声明 Agent 启动所需加载的 Cordis 插件及其依赖配置的 YAML 描述文件（通常为 `cordis.yml`）。
_Avoid_: Config File, Package Spec

**Dynamic Plugin Layer**:
存在于用户主目录或项目根目录下的外部插件目录，支持在不重新编译客户端的前提下动态挂载扩展能力。
_Avoid_: User Script, External Addon

**Diff Reviewer**:
基于 Monaco Editor 构建的代码差异审查组件，提供左右双栏及行级内联的代码变更比对与批准视图。
_Avoid_: Patch Viewer, Code Comparator

**Agent Session**:
前端维护的单个独立对话与任务执行上下文，包含历史消息流、工具调用栈及文件变更快照。
_Avoid_: Chat Thread, Task Run

**Approval Gate**:
安全拦截与授权确认机制，当 Agent 尝试执行危险命令或越权修改时阻断执行并等待用户显式批准。
_Avoid_: Auth Modal, Permission Check

**Workspace Jail**:
由 Rust 宿主实施的路径作用域限制，约束 Agent 的文件访问与工具执行必须严格限定在当前工程根目录内。
_Avoid_: Sandbox Container, Working Scope




