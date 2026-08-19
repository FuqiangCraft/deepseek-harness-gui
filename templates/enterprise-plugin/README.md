<!--
文件说明: 企业 DeepSeek Harness 插件开发指南
功能描述: 指导团队开发并挂载 dsh Cordis 插件（企业工具/模型网关/认证等），与官方基线解耦。
-->

# 企业 DeepSeek Harness 插件开发指南

基于官方 `@deepseek-ai/dsh` 引擎的 **Cordis 插件** 形态扩展企业能力。插件与官方基线完全解耦，
基线升级不触碰插件；仅当上游插件 API（`ctx.*` 服务、事件域）变化时需要审计。

---

## 1. 插件结构（本目录即模板）

```
templates/enterprise-plugin/
├── package.json      # 名称 @acme/dsh-enterprise-plugin，peer 依赖引擎的 cordis/dsh-tools
├── tsconfig.json
└── src/index.ts      # apply() + inject + ctx.tools.register(defineTool(...))
```

**三个硬性要求（否则插件无法挂载）：**

1. **导出 `apply(ctx, config)`** —— Cordis 插件约定，include loader 挂载时调用。
   必须处理 `config` 为 `undefined`（未配置时）：`export function apply(ctx, config: Config = {})`。
2. **导出 `inject`** —— 声明服务依赖，否则访问 `ctx.tools` 抛 `cannot get property "tools" without inject`：
   ```ts
   export const inject = ["tools"] as const;
   ```
3. **用 `defineTool` 注册工具**（`@deepseek-ai/dsh-tools`）—— 参数与输出用简化 schema spec，
   自动校验与类型推断（`InferArgs`/`InferValue`），`render(args, value)` 返回 `ContentBlock[]`。

## 2. 开发与构建

```bash
cd templates/enterprise-plugin
pnpm install      # registry 走官方源（Huawei 镜像存在版本滞后）
pnpm build        # 产出 lib/index.js + lib/index.d.ts
```

> peer 依赖 `@deepseek-ai/cordis`/`dsh-tools`/`dsh-llm` 与引擎同版本，保证运行时共享同一实例。

## 3. 挂载到客户端

### 3.1 安装插件包到 profile

把构建产物复制到 profile 的用户 node_modules（`<workspace 根>` 或按团队约定）：

```bash
mkdir -p ~/.dsh/profiles/web/node_modules/@acme/dsh-enterprise-plugin
cp -r lib ~/.dsh/profiles/web/node_modules/@acme/dsh-enterprise-plugin/
cp package.json ~/.dsh/profiles/web/node_modules/@acme/dsh-enterprise-plugin/
```

### 3.2 在用户层挂载（必须用 `insert:`）

编辑 `~/.dsh/profiles/web/cordis.patch.yml`：

```yaml
- insert:
    - id: acme-enterprise
      name: '@acme/dsh-enterprise-plugin'
      config:
        apiEndpoint: https://api.internal.company.com   # 可选，对应 Config
```

> ⚠️ **不要用普通 `- id: X, name: Y` 行**：那是 id-targeted 覆盖，只对已存在条目生效；
> 新条目必须放进 `- insert:` 列表，否则被静默跳过（loader 的 `applyEntryPatches` 行为）。

### 3.3 重启客户端

重启后引擎会挂载插件。验证工具已注册：
- 侧边栏/模型选择器相关 UI，或直接对 agent 说"调用 enterprise_http_get"。
- Sidecar 启动日志会打印 `registered tools (N): ...`。

## 4. 团队下发方案

- **简单方案**：把 `lib/ + package.json` 打成一个 npm 包（私有 registry 或 file://），
  团队按 §3.1 复制 + §3.2 加行。
- **批量方案**：用 profile 的 bundle 机制（`dsh.profile.bundles`）把企业插件作为 bundle
  下发，升级客户端时 profile 保持；或将插件加入 sidecar 依赖随安装包内置。

## 5. 基线升级时插件的影响

插件只依赖引擎的稳定服务接口（`ctx.tools`、事件域）。升级基线时：
1. 按 [升级基线操作手册](../../docs/runbooks/upgrade-baseline.md) 提升 `@deepseek-ai/*` 锁版本。
2. 若上游 API 破坏兼容（RC 期明确存在），审计插件用到的 `ctx.*` 接口即可；
   **基线变化本身不会让插件失效**——这是"插件化"相对"fork 二次开发"的核心收益。
