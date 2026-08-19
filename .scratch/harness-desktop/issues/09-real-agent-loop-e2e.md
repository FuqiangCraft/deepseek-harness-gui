<!--
文件说明: 任务工单 09 - 真实 agent loop 端到端验证
功能描述: 配置模型凭据后在官方 dsh web UI 发真实 prompt，验证真实 agent loop、真实工具与引擎内建审批/沙箱。
-->

# 09 — 真实 agent loop 端到端验证

**What to build:**
在官方 web UI 配置 DeepSeek 模型凭据（`DEEPSEEK_API_KEY` / `dsh` 设置），发送真实
prompt，验证：真实 agent loop（`ctx.agents` + `agent-loop`）跑通、真实工具调用、
引擎内建审批（`dsh-user-approval` 的 `approval/requested`）与沙箱
（`dsh-sandbox-policy` 默认 `workspace-write`）正常触发。确认官方 web UI 的
流式 Token、思考链、工具卡片渲染正确。

**Blocked by:** 08 — Tauri webview 加载官方 dsh web UI

**Status:** completed

- [x] 配置模型凭据，官方 UI 发送真实 prompt
- [x] 修复模型适配器挂载：base profile 未挂 `dsh-llm-deepseek`，在 boot.ts overlays 补挂
      （验证：`llm.providers` 返回 deepseek-official ACTIVE，`llm.models` 返回 v4-flash/v4-pro）
- [x] 修复 agent preset 缺失：库方式 embed 未跑 CLI composeProfile，在 boot.ts overlays 补
      `agent-presets` shipped root（`@deepseek-ai/dsh/config/agent-presets`，trust: system）
- [x] 真实 prompt 端到端验证：`session.create` 返回 `agentPreset: standard`；
      `session.prompt` accepted；会话事件含 `assistant/message` 真实模型回复 + `turn/end completed`
- [x] 危险操作审批卡片与用户放行/拒绝（用户实测无问题）
- [x] 工作区沙箱路径约束（用户实测无问题）
