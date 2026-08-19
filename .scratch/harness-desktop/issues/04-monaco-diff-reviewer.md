<!-- 
文件说明: 任务工单 04 - Monaco 代码差异审查器 (Diff Reviewer)
功能描述: 实现 Agent 提出的文件变更提取、Git 风格左右分栏/行内 Diff 对比审查及一键应用/放弃变更能力。
-->

# 04 — Monaco 代码差异审查器 (Diff Reviewer)

**What to build:**
当 Agent 在会话中调用编辑/写入工具拟定代码变更时，Sidecar 捕获变更前后的文件快照并生成补丁数据发送至前端。前端集成 Monaco Editor 差异比对器，呈现高保真的左右分栏（Side-by-Side）及内联（Inline）差异高亮视图。用户可以针对单个文件或全部文件点击“接受变更”或“拒绝变更”。

**Blocked by:** 03 — 流式 Agent 会话交互与前端响应渲染

**Status:** completed

- [x] 集成 `@monaco-editor/react` 并配置语法高亮与 Web Worker 异步加载
- [x] 实现 `DiffReviewer` 组件，支持多文件差异切换、左右分栏与行级变更标记
- [x] Sidecar 端捕获文件修改事件 `event.fileChanged` 并发送变更快照
- [x] 用户确认接受时，触发真实磁盘文件写入；用户拒绝时回滚暂存区变更

