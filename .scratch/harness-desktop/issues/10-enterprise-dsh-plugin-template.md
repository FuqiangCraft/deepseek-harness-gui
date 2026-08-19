<!--
文件说明: 任务工单 10 - 企业 DSH 插件模板与下发
功能描述: 企业功能（模型网关/认证/内网工具）做成 dsh Cordis 插件，经 $DSH_HOME/profiles bundle/patch 机制下发。
-->

# 10 — 企业 DSH 插件模板与下发

**What to build:**
把企业定制能力（内网认证、私有模型网关、代码合规检查）做成 **dsh Cordis 插件**
（`ctx.tools.register({name, description, parameters, execute})`、`ctx.agents`、
事件域），作为 npm 包经 `$DSH_HOME/profiles/<name>/` 的 bundle/patch 机制下发，
与官方基线解耦。重做 `templates/enterprise-plugin/` 为 dsh 插件新形态。

**Blocked by:** 09 — 真实 agent loop 端到端验证

**Status:** completed

- [x] 官方 Cordis 插件脚手架（`apply(ctx, config)` + `inject` 声明 + `ctx.tools.register(defineTool(...))`）
- [x] profile 用户层挂载（`~/.dsh/profiles/web/cordis.patch.yml` 用 `- insert:`，普通行对新条目是 no-op）
- [x] `templates/enterprise-plugin/` 重做为 dsh 插件模板（含 README 挂载指南）
- [x] 插件升级时基线不受影响的验证（插件独立包挂载；基线升级只需审计 ctx.* API）

**踩坑记录（已写进模板 README）：**
- 普通 `- id: X, name: Y` 行是 id-targeted 覆盖，新条目必须 `- insert:`（`applyEntryPatches` 行为）
- 插件必须 `export inject = ["tools"]`，否则 `ctx.tools` 抛 "without inject"
- `apply` 的 config 需默认值（loader 不配置时传 undefined）
- 验证：boot 日志 `registered tools (1): enterprise_http_get`；真实 session 中模型调用
  `tool/call enterprise_http_get {"path":"/api/v1/health"}` + `tool/result` ✓
