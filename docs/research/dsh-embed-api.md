# DeepSeek Harness `@deepseek-ai/dsh` 嵌入式 API 契约核实报告

> 核实对象：`@deepseek-ai/dsh` 及其子包，版本 `0.1.0-rc.7`。
> 方法：第一手源码（GitHub `deepseek-ai/deepseek-harness` @ master，`upstream.json` 标注 sourceVersion = 0.1.0-rc.7；desktop 仓库 `anywhere-labs/deepseek-harness-desktop` @ master）。每节给出可直接照抄的 import 与调用片段。
> 所有子包均为 **纯 ESM**（`"type": "module"`），构建产物在 `lib/`（tsdown，`format: ['esm']`）。
> 本报告覆盖"库方式嵌入"的两个官方路径：(A) **纯进程内/纯 stdio** —— `headless` profile 与 `dsh-sdk-jsonrpc-server`；(B) **loopback HTTP/WS** —— desktop 的做法（`dsh-web-app` + `dsh-host-webserver`）。

---

## 0. 总体架构：进程内嵌入的两种官方模式

- **Engine = Cordis root（`Context`）+ Loader 插件树**。没有任何"createEngine"单函数；入口是 `@deepseek-ai/dsh-app-boot` 的 `boot()`，它 `new Context()` → `ctx.plugin(Loader)` → 挂 `mountRootInclude` → 让整棵 `cordis.yml`/patch 插件树 settle，返回 root `Context`。之后通过 `ctx.agents` / `ctx.sessions` / `ctx.tools` 等 service 驱动。
- 桌面（Electron main）走的正是这条库方式路径：`import { boot } from '@deepseek-ai/dsh-app-boot'`，进程内起 Host，再经 **loopback HTTP/WS**（`dsh-host-webserver`）把官方 web UI 喂给 renderer。
- 纯 stdio 路径由 `headless` bundle 和 `@deepseek-ai/dsh-sdk-jsonrpc-server` 提供：**不依赖任何 HTTP**。

来源：https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/app-boot/src/index.ts
- desktop：https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/dsh-plugin-desktop/src/main.ts

---

## 1. 进程内启动引擎的最小代码

### 1.1 核心入口 `boot()`

import 自 `@deepseek-ai/dsh-app-boot`（来源：`packages/boot/app-boot/src/index.ts`，函数在 757–802 行）：

```ts
import { boot, type PatchOptions } from '@deepseek-ai/dsh-app-boot'
import { Context } from '@deepseek-ai/cordis'

export async function boot(
  binName: string,
  absoluteConfigPath: string,                       // 必须已 resolve 为绝对路径
  patches?: PatchOptions[],                         // Loader include patch 覆盖层（可选）
  prepare?: (ctx: Context) => Promise<void> | void, // Host 准备回调，在插件树挂载前执行
  bareModuleBaseUrl?: string,                       // 封闭打包时 bare package 的 base URL
): Promise<Context>
```

`boot()` 内部：`new Context()` → `ctx.baseUrl = <config 目录> + '/'` → `ctx.plugin(Loader)` → `await prepare?.(ctx)` → `mountRootInclude(ctx, config, patches, bareModuleBaseUrl)` → `ctx.get('loader').await()` → `assertEntriesActivated(ctx, binName)`。失败时 `ctx.fiber.dispose()` 后抛 `binName: <stage>: <detail>`。

同包还导出（`profile.ts`）：`loadProfile`、`initProfile`、`composeEntries`、`resolveProfileDir`、`PROFILE_TEMPLATES`、`DEFAULT_PROFILE_BUNDLES`、`PROFILE_PATCH_FILENAME`、`loadOptionalPatches`、`loadOverlayPatches`、`mountRootInclude`、`installFailLoud`、`loadLayeredEnv`、`resolveConfigPath`、类型 `Profile`/`ProfileLayer`/`PatchOptions`。

### 1.2 桌面 Electron main 的照抄范本

desktop 的启动链路（`dsh-plugin-desktop/src/main.ts`，`start()` 内）：
1. `resolveDshHome()`（`@deepseek-ai/dsh-home-paths`）定位 `$DSH_HOME`（默认 `~/.dsh`）；
2. `prepareDesktopProfile(...)`（desktop 自己的 profile 合成）返回 `{ homeDir, profile, rootConfig, bareModuleBaseUrl, patches, mode, port }`；
3. `const ctx = await boot(BIN_NAME, prepared.rootConfig, prepared.patches, async (hostCtx) => { ... hostCtx.provide(...); await hostCtx.plugin(...) }, prepared.bareModuleBaseUrl)`；
4. `provideCmdline(hostCtx, { args: ['--host','127.0.0.1','--port',String(prepared.port)], exit: requestQuit })`。

关键 import（照抄自 desktop `main.ts` 1–31 行）：

```ts
import { boot, installFailLoud, loadLayeredEnv, PROFILE_PATCH_FILENAME, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import type { Context } from '@deepseek-ai/cordis'
```

来源：https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/dsh-plugin-desktop/src/main.ts

### 1.3 desktop 的 package.json 依赖清单（原样）

desktop 是 Yarn 4 workspace，依赖集中在 `dsh-plugin-desktop`（`dsh-plugin-desktop/package.json`）。与引擎直接相关的依赖：

```jsonc
// dsh-plugin-desktop/package.json (节选)
"dependencies": {
  "@deepseek-ai/cordis": "4.0.1",
  "@deepseek-ai/cordis-plugin-group": "1.0.1",
  "@deepseek-ai/cordis-plugin-include": "1.0.6",
  "@deepseek-ai/cordis-plugin-loader": "1.0.2",
  "@deepseek-ai/cordis-plugin-timer": "1.1.3",
  "@deepseek-ai/dsh": "0.1.0-rc.7",                     // CLI 包（其 lib/bin.js 是 dsh 命令）
  "@deepseek-ai/dsh-agent": "0.1.0-rc.7",
  "@deepseek-ai/dsh-agent-default-model": "0.1.0-rc.7",
  "@deepseek-ai/dsh-agent-presets": "0.1.0-rc.7",
  "@deepseek-ai/dsh-app-boot": "0.1.0-rc.7",           // boot() 所在包
  "@deepseek-ai/dsh-base": "0.1.0-rc.7",
  "@deepseek-ai/dsh-cmdline": "0.1.0-rc.7",
  "@deepseek-ai/dsh-headless": "0.1.0-rc.7",           // 纯 stdio 模式 bundle
  "@deepseek-ai/dsh-host-webserver": "0.1.0-rc.7",     // loopback HTTP/WS
  "@deepseek-ai/dsh-session": "0.1.0-rc.7",
  "@deepseek-ai/dsh-subprocess-local": "0.1.0-rc.7",
  "@deepseek-ai/dsh-sandbox": "0.1.0-rc.7",
  "@deepseek-ai/dsh-sandbox-windows-acl": "0.1.0-rc.7",
  "@deepseek-ai/dsh-tools": "0.1.0-rc.7",
  "@deepseek-ai/dsh-web-app": "0.1.0-rc.7",            // Web 表面 bundle（loopback 目标）
  "@deepseek-ai/dsh-agent-loop": "0.1.0-rc.7",         // 具体 agent 驱动 loop 插件
  "@deepseek-ai/dsh-llm": "0.1.0-rc.7",
  "@deepseek-ai/dsh-user-approval": "0.1.0-rc.7",
  "@deepseek-ai/dsh-permission-presets": "0.1.0-rc.7",
  "koffi": "3.1.5",                                    // Windows FFI（sandbox ACL）
  "node-addon-require-builtin": "^0.1.4",
  "pnpm": "11.7.0"
},
"peerDependencies": { "electron": "43.4.0" },
"type": "module",
"main": "lib/main.js",
"engines": { "node": "^22.19.0 || >=24.0.0" }
```

完整清单含 110+ 个 `@deepseek-ai/*` 0.1.0-rc.7 依赖。desktop 顶层 `resolutions` 对 4 个包打了 patch（见 §6.2）。来源：https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/dsh-plugin-desktop/package.json

### 1.4 桌面确实用了 loopback HTTP/WS —— 有纯进程内/纯 stdio 的替代吗？

- **桌面用的是 loopback HTTP/WS**：`prepareDesktopProfile` 里强制 patch 了 webserver 行 `config: { host: '127.0.0.1', port }`（`dsh-plugin-desktop/src/profile.ts` 571–575 行），`dsh-web-app` bundle 挂 `dsh-host-webserver` + `dsh-client-connection`（browser 侧 fetch/SSE 客户端）。desktop 只是给官方 web-app 套了层 Electron 壳。
- **有，不依赖 HTTP 的纯进程内方式**，两条：
  1. **`headless` profile / `@deepseek-ai/dsh-headless` bundle** —— 明确"no Host, HTTP, or browser layer"，直接驱动核心 Agent（见 §2.3 完整代码）。
  2. **`@deepseek-ai/dsh-sdk-jsonrpc-server`** —— 挂到 `boot()` 出来的 Context 上的插件，在 **stdio 上跑 newline-delimited JSON-RPC**（`session/prompt` / `initialize` / `shutdown`，通知 `session.event`/`session.status`/`subagent.started`/`subagent.finished`）。参考组成见 `examples/jsonrpc-agent/cordis.yml`。

来源：
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/headless/package.json
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/server/src/server.ts
- https://github.com/deepseek-ai/deepseek-harness/blob/master/examples/jsonrpc-agent/cordis.yml
- https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/dsh-plugin-desktop/src/profile.ts

---

## 2. 驱动一次 agent turn：`ctx.agents` 的确切 API

Agent 创建接口定义在 `@deepseek-ai/dsh-agent`（`packages/core/agent/src/index.ts` 与 `types.ts`）；具体驱动在 `@deepseek-ai/dsh-agent-loop`（`packages/core/agent-loop`）。

### 2.1 创建/恢复

```ts
import type { AgentHandle, CreateAgentOptions, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'

// 工厂路径（AgentLoop 构造时已 ctx.agents.setFactory(this)，所以这两者可用）：
const handle: AgentHandle = await ctx.agents.create({
  sessionId: SessionId('my-session-1'),
  meta: { cwd: '/abs/workspace' },                 // 可选：绝对 cwd、parentSession、origin、agentPreset…
  seed: undefined,                                  // 可选：replay/fork 历史 SessionEvent[]
  agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash', maxTokens? },
  setup: (agentCtx) => { /* 在 publish 前给 agent 装工具/提示词；可返回 { commit() } */ },
  signal: undefined,                                // 可选 AbortSignal，仅覆盖 setup/发布期
})
// AgentHandle = { agent: Agent; dispose(): Promise<void> }

const resumed: AgentHandle = await ctx.agents.resume({
  resumeSessionId: SessionId('existing-id'),
  agentOptions: { /* … */ },
})
```

- `ctx.agents` 是 `AgentRegistry`（`@deepseek-ai/dsh-agent`），`create/resume` 委托给注册的 `AgentFactory`（即 `AgentLoop`）。
- 同步快捷方式（不跑 setup、由 loop fiber 持有）：`ctx.agentLoop.create(id: SessionId, options?: AgentOptions, meta?: { cwd?: string }): Agent`（`dsh-agent-loop` 的 `AgentLoop.create`，589–598 行）。
- 必需 service：`agents`, `sessions`, `llm`, `tools`, `systemPrompt`（`AgentLoop` 注入列表）。`provider`+`model` 二者都必须给；`agent-default-model` 提供默认选择 `defaultModel.currentSelection()` → `{ provider, model }`。

来源：
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent/src/index.ts（405–430 行 create/resume）
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent-loop/src/index.ts（589–710 行 create/createAgent/resume）

### 2.2 发消息、收结果（`Agent` 接口）

`Agent`（`packages/core/agent/src/runtime-types.ts`，64–144 行）：

```ts
interface Agent {
  readonly id: SessionId
  readonly options: AgentOptions             // { provider, model, maxTokens? }
  readonly session: Session                 // 存活 session；log 是唯一事实源
  readonly inbox: Inbox
  readonly status: 'idle' | 'running'
  readonly ctx: Context                     // agent 作用域 context（装工具/提示词用）
  cancel(cause: AgentCancelCause, options?: { keepInbox?: boolean }): void
  whenIdle(): Promise<void>                 // 等到当前 driver 静默
  send(message: UserMessage, target: 'next-turn' | 'next-step', wakeup: boolean): void
  followup(message: UserMessage): void      // = send(msg,'next-turn',true)
  steer(message: UserMessage): void         // = send(msg,'next-step',true)
  inject(message: UserMessage): void        // = send(msg,'next-step',false)
}
```

构建消息：`import { createUserMessage } from '@deepseek-ai/dsh-llm'`；`UserMessage = { id: MessageId, role:'user', content: ContentBlock[], source: MessageSource }`；`ContentBlock` 是 `{ type:'text'|'reasoning'|'image'|'tool-call'|'tool-result', … }` 的判别联合（`@deepseek-ai/dsh-llm/types`）。

持久化 flush：`await ctx.sessions.flush(agent.session): Promise<boolean>`（`dsh-session` 的 `SessionStore.flush`，session-index.ts 1022 行）。

### 2.3 headless 官方实现（直接照抄）

`@deepseek-ai/dsh-headless` runner（`packages/bundle/headless/src/index.ts` 的 `run()`，96–134 行）就是最小进程内驱动范本：

```ts
const { agent } = await agents.create({
  sessionId: SessionId(`session-${randomUUID()}`),
  meta: { cwd: process.cwd() },
  agentOptions: { provider: selection.provider, model: selection.model },
  setup: (agentCtx) => { installModelSelection(agentCtx, { current: selection, assembled: undefined }) },
})
await agent.whenIdle()
const firstSeq = agent.session.seq
agent.followup(createUserMessage({ content: [{ type: 'text', text: task }], source: { kind: 'user' } }))
await agent.whenIdle()
await sessions.flush(agent.session)
// 之后在 agent.session.events 里扫 assistant/message 与 turn/end 汇总结果
```

`run()` 通过 `ctx.get('agents')` / `ctx.get('agentDefaultModel')` / `ctx.get('sessions')` 拿服务（先 `await ctx.get('loader')?.await()` 等整棵树 settle）。进程退出用 `ctx.get('appExit')`（由宿主 `provideCmdline` 提供）。来源：https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/headless/src/index.ts

---

## 3. 事件订阅：`session/*` 与 `agent/*` 事件域

事件分两层：**进程内 Cordis 事件**（`ctx.on('…')`，desktop/SDK server 的宿主侧订阅就是这个）与**经 wire 转发给前端的事件**（web mux/host 流）。

### 3.1 进程内订阅 API（宿主侧权威接口）

SDK server 原样照抄（`packages/sdk/server/src/server.ts` 70–77 行）：

```ts
ctx.on('session/event', (session, event) => { /* 每一条 durable session-log 事件 */ })
ctx.on('session/created', (session) => {})
ctx.on('session/disposed', (session) => {})
ctx.on('agent/status', ({ agent, status }) => {})   // status: 'idle' | 'running'
ctx.on('subagent/end', …)                            // subagent 结束（scope-filtered）
```

`session/*` 事件声明（`packages/core/session/src/index.ts` 37–87 行）：
- `'session/created'(this: Scoped<Session>, session)`（emit）
- `'session/disposed'(this: Scoped<Session>, session)`（emit）
- `'session/event'(this: Scoped<Session>, session, event: SessionEvent)`（emit，append 后 fire-and-forget feed）
- `'session/flush'(this: Scoped<Session>, session): Promise<void> | void`（parallel，持久化屏障）

`agent/*` 事件声明（`packages/core/agent/src/runtime-types.ts` 146–291 行）：
- `agent/created` `{ agent }`（emit）、`agent/disposed` `{ agent }`（emit）、`agent/status` `{ agent, status }`（emit）
- `agent/session-start` `{ agent, source: 'startup'|'resume'|'clear'|'compact' }`（emit）
- `agent/inbox/inserted` `{ agent, message }`、`agent/inbox/claimed` `{ agent, message, turn }`、`agent/inbox/discarded` `{ agent, message }`（emit）
- `agent/pre-step` `{ agent, messages, turn, step, signal }`（waterfall → `PreStepDecision`）
- `agent/request` `{ agent, turn, step, signal }`（waterfall → `LlmCallConfig`）
- `agent/request-error` `{ agent, turn, step, provider, failure, retryPolicy, signal }`（waterfall）
- `agent/turn-stopping` `{ agent, turn, signal }`（serial）
- `agent/error` `{ agent, turn, step, error }`（emit）
- `agent-loop/config-start-failed` `{ sessionId, error }`（emit，agent-loop 声明）

所有事件都是 **scope-filtered**（`@deepseek-ai/dsh-scope`）：agent 作用域的监听器只收到自己的 agent。普通全局订阅用 `ctx.on('session/event', …)` 即可（SDK server 的做法，session 作用域 carrier 在 store `enter` 时取 `scopeOf(this.ctx)`）。

### 3.2 durable `SessionEvent` 信封与 payload（token/思考/工具/审批）

`SessionEvent`（`packages/core/session/src/types.ts` 404–436 行）：

```ts
type SessionEvent = {
  type: SessionEventType
  seq: number        // 会话内单调序号
  time: number       // epoch ms
  data: SessionEventMap[type]
  ignorable?: true
  // 仅 surface 事件（user/message, assistant/message, tool/result）携带：
  sourceEventSeqs?: number[]
  surfaceOp?: 'append' | { op: 'replace'; start: number; end: number }
}
```

完整类型清单（`session/src/known-event-types.ts`，60 个类型）。核心 payload（`session/src/types.ts`）：

| type | data |
|---|---|
| `turn/start` / `turn/end` | `{ turn }` / `{ turn, reason: TurnEndReason }` |
| `step/start` / `step/end` | `{ turn, step }` |
| `user/message` | `UserMessage` |
| `assistant/chunk`（token 流） | `{ turn, step, chunk: StreamChunk }` |
| `assistant/message`（含思考聚合后内容） | `{ turn, step, message: AssistantMessage, usage?: TokenUsage }` |
| `tool/call` | `{ turn, step, callId, name, arguments: string /*模型原始 JSON 串*/ }` |
| `tool/result` | `{ turn, step, message: ToolResultMessage, error?: {name,code}, meta?: JsonValue }` |
| `todo/write` | `{ todos: TodoItem[] }` |
| `request/header` | `{ header: EpochHeader, reason: 'initial'|'resume'|'change' }` |
| `session/end-seed` | `{}` |

`StreamChunk`（`packages/llm/llm/src/types.ts` 312–324 行）：`block-start` / `text-delta` / `reasoning-delta` / `tool-call-delta` / `block-end` / `usage` / `finish`。**思考内容在 `reasoning-delta` 里**，逐 token 流式到达，最终聚合进 `assistant/message` 的 `content`（含 `reasoning` 块）。

审批/权限事件（`@deepseek-ai/dsh-user-approval`，`packages/interaction/user-approval/src/index.ts` 44–71 行）：
- `approval/asked` `{ id: ApprovalRequestId, toolName: string, callId?: CallId, reason?: string }`
- `approval/decided` `{ id: ApprovalRequestId, outcome: 'allowed-once'|'rejected'|'cancelled'|'unavailable' }`
- `approval/policy` `{ policy: 'ask'|'never', source?: 'delegation' }`

### 3.3 desktop 的 host↔renderer 转发（web 协议）

desktop 的 renderer 是**官方 web-app 前端**，经 `dsh-host-apiproxy`（gateway，`ctx.apiProxy`）+ `dsh-host-webserver` 走 `/api` fetch/SSE。desktop 自身只额外注册了几个 HTTP 路由（renderer boot 上报、目录选择，见 `dsh-plugin-desktop/src/index.ts`）。**前端订阅的是 `EventsApi` 的两条流**（`packages/host/apiproxy/src/api/events.ts`）：

- **`mux` 流**帧（`MuxFrame`，69–108 行）：
  - `{ type:'session/event', sessionId, event: SessionEvent, view?: ToolEventView }` —— durable 事件原样透传
  - `{ type:'session/subscribed', sessionId, lastSeq }`
  - `{ type:'approval/requested', sessionId, approvalId, toolName, callId?, reason? }`（可应答服务端请求）
  - `{ type:'approval/resolved', sessionId, approvalId, outcome }`
  - `{ type:'question/requested' }` / `{ type:'question/resolved' }`（ask_user_question）
  - `{ type:'session/queue', sessionId, items }`（inbox 全量快照）
  - `{ type:'session/jobs', sessionId, jobs }`
  - `{ type:'session/projection', sessionId, key, value, seq }`
  - `{ type:'stream/error', error }`
- **`host` 流**帧（`HostFrame`，127–155 行）：`host/session-added`、`host/session-removed`、`host/session-status { sessionId, running }`、`host/agent-error`、`host/workspace-*`、`host/archived-sessions-changed`、`host/remote-event { event, args }`。
- `host/remote-event` 白名单 `API_REMOTE_FORWARDED_EVENTS`（`packages/api/remotes/src/remote-events.ts` 17–29 行）：`agent-preset/selected`、`commands/change`、`credentials/updated`、`cordis/request-run`、`cordis/request-run-resolved`、`cordis/dynamic-package`、`cordis/dynamic-retract`、`cordis/inspect-query`、`cordis/inspect-query-resolved`、`llm/adapters-updated`、`settings/document-updated`。

**嵌入我们的 sidecar 时，进程内直接用 `ctx.on('session/event', …)` 就能拿到与桌面前端完全相同的 token/思考/工具调用/审批事件流**，无需 web 层。

来源：
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/server/src/server.ts
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/host/apiproxy/src/api/events.ts
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/api/remotes/src/remote-events.ts

---

## 4. 工具注册：`ctx.tools`

### 4.1 注册 API

`ctx.tools` 是 `ToolRuntime`（`@deepseek-ai/dsh-tools`，`packages/core/tools/src/index.ts`）：

```ts
ctx.tools.register(definition: ToolDefinition): () => void    // 返回 disposer
ctx.tools.guard(guard: ToolGuard): () => void                 // 幂等所有者策略（deny/ask）
ctx.tools.restrict(filter: ToolRestriction): () => void       // 作用域可见性过滤
ctx.tools.get(name: string, scope?: ScopeKey): ToolDefinition | undefined
ctx.tools.schemas(scope?: ScopeKey): ToolSchema[]
```

`ToolDefinition`（index.ts 222–279 行）：

```ts
interface ToolDefinition extends ToolSchema {
  // ToolSchema = { name: string; description: string; parameters: Record<string, unknown> /* JSON Schema */ }
  readonly output: ToolOutputDefinition   // { schema: JsonSchemaNode; render(args, value): ContentBlock[]; presentationMeta? }
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>  // 返回 canonical JSON value
  finalizeContent?(exec, result): ContentBlock[] | undefined
  timeoutMs?: number                      // 协作式超时（dsh-tool-call-timeout-policy 强加）
  isConcurrencySafe?(args): boolean
  presentCall?(args): ToolCallView | undefined
}
```

**参数 schema 是 JSON Schema**（`parameters: Record<string, unknown>`），与 model 请求中的 `ToolSchema` 同构。工具执行管线（事件，index.ts 142–208 行）：`tools/pre-execute`（waterfall，`PreToolDecision = { kind:'allow'|'deny'|'ask' }`）→ `tools/execute`（waterfall）→ `tools/post-execute`（waterfall）→ `tools/result`（emit）。工具可及性变化触发 `tools/change`（emit）。

### 4.2 工具触发审批/权限的机制

- 引擎侧：`@deepseek-ai/dsh-user-approval`（`approval` 行）在 **`tools/pre-execute`** 上做 ask/never 判定；需要询问时调 `ctx.approval.request({ agent, toolName, callId?, reason? }): Promise<ApprovalOutcome>`（`packages/interaction/user-approval/src/index.ts` 257–276 行），它：
  1. `session.append('approval/asked', { id, toolName, callId?, reason? })`（durable 审计）；
  2. 走 **`'approval/request'(this: Scoped<ApprovalService>, req: ApprovalRequest, next): Promise<ApprovalOutcome>`** waterfall（30 行）找 answerer —— **宿主在这个瀑布里收到审批请求**；SDK/桌面场景由 `dsh-client-ui-permission-presets`/`ui-permission` 经 `apiProxy.events` 的 `approval/requested` 帧交给浏览器渲染；
  3. `session.append('approval/decided', { id, outcome })` 收尾。
- 权限预设：`@deepseek-ai/dsh-permission-presets`（`permission` 行）提供 `read-only` / `workspace-write` / `danger-full-access`，映射 `sandbox` + `approval`（base patch 189–205 行）。`dsh-sandbox-policy` 行默认 `mode: process.env.DSH_PERMISSION_MODE ?? 'workspace-write'`，`workspaceRoot: process.cwd()`。
- `ApprovalOutcome`：`'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`（fail-closed）。

来源：
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/src/index.ts
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/interaction/user-approval/src/index.ts
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/base/cordis.patch.yml

---

## 5. profile/bundle 加载：headless 怎么做到不监听端口

### 5.1 概念与常量（`packages/boot/app-boot/src/profile.ts`）

- `$DSH_HOME` 默认 `~/.dsh`，`resolveDshHome()` 解析优先级：显式参数 > `$DSH_HOME` > `~/.dsh`（`packages/util/home-paths/src/index.ts`）。
- 每个 profile 是 `$DSH_HOME/profiles/<name>/` 下的目录：`package.json`（含 `dsh.profile.bundles: string[]`）+ `cordis.patch.yml`（用户 patch 层）+ `pnpm-workspace.yaml`。
- 每个 **bundle 是一个 npm 包**，其 `package.json` 声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`，即一个 patch 列表。
- 模板（profile.ts 114–125 行）：

```ts
export const PROFILE_TEMPLATES: Record<string, readonly string[]> = {
  web:     ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
  headless: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'],
}
export const DEFAULT_PROFILE_BUNDLES: readonly string[] = ['@deepseek-ai/dsh-base']
```

- `loadProfile(binName, name, installAnchor, home?, { userLayer? }): Profile`：`Profile = { name, dir, layers: ProfileLayer[], patchPath, patches }`；`ProfileLayer = { packageName, packageDir, patchPath, patches }`。
- `initProfile(dir, bundles)` 建目录；`composeEntries(layers: PatchOptions[][]): EntryOptions[]` 合成最终 entry list；模块解析双锚：安装锚优先、profile 目录兜底（`resolveBundleDir`），另有 `healProfilesModuleFallback` 建 `$DSH_HOME/profiles/node_modules` 扁平符号链接层。

### 5.2 headless 为什么不开端口

`@deepseek-ai/dsh-headless` bundle（`packages/bundle/headless/cordis.patch.yml`，35 行）在 base 之上只挂 4 件事：改 `system-prompt` persona、`hmr: disabled`、`tools` mode、insert `code-runtime` + `headless-startup` + `headless-runner`。**没有任何 Host / HTTP server / Web runtime / 浏览器插件行** —— 这就是"不监听端口"的机制：根本没有 webserver 行。`headless-runner`（见 §2.3）一次性跑完任务后 `ctx.get('appExit')(0)` 退出进程。

### 5.3 程序化等价物

CLI 的 `runProfile`（`apps/cli/src/profile-boot.ts`）就是程序化 API 的参考实现：

```ts
const profile = loadProfile('dsh', name, INSTALL_ANCHOR, home)   // 自动 initProfile(模板)
const bundlePatches = profile.layers.flatMap(layer => layer.patches)
const rootConfig = join(profile.dir, 'cordis.yml')               // 空根 '[]'（见 PROFILE_ROOT_CONFIG）
const ctx = await boot('dsh', rootConfig, structuredClone([...bundlePatches, ...profile.patches, ...overlays]), (hostCtx) => {
  hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
  provideCmdline(hostCtx, { args, exit })
})
```

要点：
- 程序化嵌入时 **你自己就是 launcher**：选一个 `cordis.yml`（可空根 + 纯 patches，与 profile 相同），`boot()` 即可；不必用文件 profile —— patches 数组可直接传入。
- 不想开 HTTP：mount headless 的行集（或干脆不加 webserver 行）。desktop 之所以开 `127.0.0.1` 是因为它要喂官方 UI；**sidecar 纯进程内不需要**。
- 参考：官方 SDK 组合示例 `examples/jsonrpc-agent/cordis.yml`（挂 `sdk-jsonrpc-server` + `llm-deepseek` + `subprocess-local` + `bash-local` + `sandbox*` + `session-persistence-jsonl` + `tool-*`，无任何 HTTP）。

来源：
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/app-boot/src/profile.ts
- https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/src/profile-boot.ts
- https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/headless/cordis.patch.yml
- https://github.com/deepseek-ai/deepseek-harness/blob/master/examples/jsonrpc-agent/cordis.yml

---

## 6. 打包与 ESM 兼容

### 6.1 ESM / Node / 构建事实

- **全部子包纯 ESM**：每个 `package.json` 都有 `"type": "module"`、`main: lib/index.js`、`types: lib/types/index.d.ts` + 子路径 exports（`.`, `./types`, `./invariant`, `./src/*`, `./package.json`）。例：`@deepseek-ai/dsh-app-boot`、`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-session`（多一个 `./surface`）、`@deepseek-ai/dsh-llm`（多 `./types`、`./brand`、`./message`）、`@deepseek-ai/dsh-tools`（多 `./presentation`）、`@deepseek-ai/dsh-agent-loop`。
- 构建：tsc + tsdown，`format: ['esm']`、`platform: 'node'`、`target: 'es2024'`（root `tsdown.config.ts`）。tsconfig：`"module": "esnext"`、`"moduleResolution": "bundler"`、`"allowImportingTsExtensions": true`、`"strict": true`（root `tsconfig.base.json`）。
- **Node 引擎硬性要求 `^22.19.0 || >=24.0.0`**（root `package.json` `engines` 与 desktop 一致）。类型面向 Node 22+（用到 `node:sqlite`、`process.loadEnvFile`、`Promise.withResolvers` 等）。
- 由 `"type":"module"` + 标准 `exports` map 构成的 tsc 项目（`moduleResolution: bundler`/`nodenext`）可以直接 `import` 各子包，无 CJS 互操问题。
- **peerDependencies 是重头**：每个核心包把 `@deepseek-ai/cordis` 及若干 `@deepseek-ai/*` 列为 peer（例：`dsh-agent` peer 含 `dsh-invariants`、`dsh-llm`、`dsh-scope`、`dsh-session`、`dsh-system-prompt`、`dsh-typert-protocol`、`cordis`）。嵌入时**必须保证整个进程只有一份 `@deepseek-ai/cordis` 实例**（pnpm 的 workspace/hoisted 布局天然满足；desktop 也用 `pnpm-workspace.yaml` + `nodeLinker: hoisted` 保证单一 cordis）。`dsh-app-boot` 对 `cordis-plugin-hmr` 标了 `peerDependenciesMeta.optional: true`。

### 6.2 native / optional 依赖坑（Windows sidecar 视角）

- `native/landlock-run`：**仅 Linux**（packages/linux-x64、linux-arm64），供 `dsh-bash-sandbox` 用。base patch 里 `bash-sandbox` 行 `disabled: !!js process.platform === 'win32'`，Windows 换成 `pwsh-sandbox`。**Windows 嵌入不触碰 landlock。**
- `node-pty`：只在 terminal 系包（`dsh-terminal` / `dsh-terminal-bash`）里，**base bundle 不挂 terminal**，故最小嵌入不需要 node-pty。desktop 因内置终端所以 `dependenciesMeta` 标 `built: true`。
- `koffi`（Windows FFI，3.1.5）：`dsh-sandbox-windows-acl` 用它做 Windows ACL 沙箱（桌面 resolutions 把 koffi 钉到 3.1.5）。base 依赖 `dsh-sandbox`/`dsh-fs` 链路会拉它，Windows 上需要能安装/构建。
- `node-addon-require-builtin`（0.1.4）：desktop 与 `@deepseek-ai/dsh` 都直接依赖，用于 built Loader 的 bare module 解析。
- `dsh-subprocess-local` 在 desktop 里标 `built: true`。

### 6.3 desktop `patches/` 里打的 Windows（及其他）补丁（原样清单）

来源：https://github.com/anywhere-labs/deepseek-harness-desktop/blob/master/patches/
（`resolutions` 对应关系见 desktop root `package.json`。）

| patch 文件 | 目标包 | 内容 |
|---|---|---|
| `app-builder-lib@26.15.7.patch` | electron-builder（mac 签名的 `createKeychain`） | `importCerts` 增加 `keychainPassword` 参数；`set-key-partition-list -k` 改用 keychain 密码。非 Windows 相关 |
| `dsh-llm-deepseek@0.1.0-rc.7.patch` | `@deepseek-ai/dsh-llm-deepseek` | `translate()` 里 `if (call.id !== void 0)` → `if (call.id)`；`if (call.function?.name !== void 0)` → `if (call.function?.name)`（避免空 tool-call 生成 `callId: undefined` 块） |
| `dsh-sandbox-windows-acl@0.1.0-rc.7.patch` | `@deepseek-ai/dsh-sandbox-windows-acl` | koffi `spawnSandboxed`/`spawnSandboxedInherited` 的 `STARTUPINFO` `dwFlags: 256` → `257` 并补 `wShowWindow: 0`（`STARTF_USESHOWWINDOW` + 隐藏窗口，避免 sandbox 命令弹窗）。**Windows 相关的关键 patch** |
| `dsh-client-ui-directory-picker-browse@0.1.0-rc.7.patch` | `dsh-client-ui-directory-picker-browse` | 大补丁（21KB），browse picker UI 的定制（Windows 上替代 native picker） |
| `dsh-client-ui-workspace@0.1.0-rc.7.patch` | `dsh-client-ui-workspace` | 给 workspace browser 根节点加 `data-dsh-workspace-drop-target` 属性（拖放目标钩子） |

另：desktop `resolutions` 还有 `"koffi@npm:^3.1.0": "3.1.5"`。

---

## 附：嵌入决策速查（结论）

- **最小进程内启动**：`new Context` 由 `boot()` 内部完成；你只写 `boot('mysidecar', '/abs/cordis.yml', patches, prepare, bareModuleBaseUrl)`。若用文件 profile：`loadProfile`/`initProfile`/`PROFILE_TEMPLATES` 全在 `@deepseek-ai/dsh-app-boot`。
- **不依赖 HTTP**：用 `@deepseek-ai/dsh-headless` 的行集，或直接用 `ctx.agents.create()` + `agent.followup()`（headless runner / SDK server 都是这个模式）；`appExit` 用 `provideCmdline` 提供。不要挂 `dsh-web-app`/`webserver`/`dsh-client-connection` 行。
- **订阅**：`ctx.on('session/event' | 'session/created' | 'session/disposed' | 'agent/status' | 'agent/error', …)`。
- **注册工具**：`ctx.tools.register({ name, description, parameters: JSONSchema, output: { schema, render }, execute })`；审批走 `tools/pre-execute` → `ctx.approval.request()`（宿主在 `approval/request` waterfall 应答）。
- **ESM**：全部纯 ESM + `type: module`；Node ≥22.19；注意单一 `@deepseek-ai/cordis` 实例与 koffi（Windows）。
