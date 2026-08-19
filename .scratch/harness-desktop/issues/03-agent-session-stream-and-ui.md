<!-- 
文件说明: 任务工单 03 - 流式 Agent 会话交互与前端响应渲染
功能描述: 实现前后端 Agent 会话生命周期管理、实时 Token 流式推流、思考链与工具调用卡片渲染及任务中断能力。
-->

# 03 — 流式 Agent 会话交互与前端响应渲染

**What to build:**
开发者在前端界面创建 Agent 会话并输入 Prompt，Rust 宿主通过 Stdio RPC 将任务分发至 Harness 运行时。Harness 启动 Agent 执行循环，将 LLM 推理的 Token 流、思考过程与工具调用过程实时推送到前端，界面实现打字机式流式渲染与工具折叠面板；用户可随时点击“中断”按钮立即终止当前任务。

**Blocked by:** 02 — Sidecar 微内核与双层插件动态加载器

**Status:** completed

- [x] 实现前端 React 会话状态管理与多会话（Agent Session）切换
- [x] 实现 Sidecar 端的 `session.sendMessage` 与 `event.streamToken` 流式事件分发
- [x] 前端实现 Markdown 富文本渲染、思考过程折叠块与工具调用日志卡片
- [x] 实现 `session.interrupt` 中断信号链路，验证中断时模型请求与工具执行即时终止

