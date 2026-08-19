<!-- 
文件说明: 任务工单 05 - 工作区沙箱与敏感操作审批门禁
功能描述: 实现工作区路径约束 (Workspace Jail) 以及针对 Shell 命令与危险工具的审批门禁 (Approval Gate)。
-->

# 05 — 工作区沙箱与敏感操作审批门禁

**What to build:**
Agent 在执行任何文件操作与工具调用时，受到严格的工作区路径约束（Workspace Jail），禁止访问或越权修改选定工程目录之外的文件。当 Agent 拟执行高危操作（如 Shell 指令执行、非临时文件删除、外部网络通信）时，运行时挂起执行并向前端发送审批请求，前端弹出 Approval Gate 交互卡片，必须经由用户显式点击“允许”后才放行，若用户点击“拒绝”则向 Agent 返回被用户拒绝的错误信息。

**Blocked by:** 04 — Monaco 代码差异审查器 (Diff Reviewer)

**Status:** completed

- [x] Rust 宿主与 Sidecar 联合实现工作区路径规范化校验（Path Traversal Guard）
- [x] Sidecar 实现工具拦截中介层，对高危工具触发 `request.requireApproval`
- [x] 前端实现审批对话框与卡片，显示拟执行的命令细节与风险提示
- [x] 实现审批结果响应链路 `approval.respond`，验证用户同意/拒绝时 Agent 的相应分支流转

