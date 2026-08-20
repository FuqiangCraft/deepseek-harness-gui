<!--
文件说明: DeepSeek Harness 基线升级操作手册
功能描述: 记录升级固定版本基线（@deepseek-ai/dsh@0.1.0-rc.7）的完整流程：锁版本、审计、补丁、重打包、验证。
-->

# 基线升级操作手册（DeepSeek Harness Desktop）

当前基线：`@deepseek-ai/*@0.1.0-rc.7`（全部钉死，见 `sidecar/package.json`）。
升级原则：**不 fork、固定版本、契约依赖、补丁复查**。升级 = 提升锁定版本 + 审计插件 API + 复查补丁 + 重打包。

## 1. 确认上游新版本

```bash
cd sidecar
pnpm view @deepseek-ai/dsh version            # 当前最新发布
pnpm view @deepseek-ai/dsh versions --json    # 全部版本
```

同时查看上游 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的
CHANGELOG / releases / breaking-changes 说明——RC 期**明确存在破坏性兼容变更**。

## 2. 提升锁版本

`sidecar/package.json` 中所有 `@deepseek-ai/*` 依赖（约 105 个）统一提升到新版本，
保持一致。然后：

```bash
cd sidecar && pnpm install
```

> 注意：Sidecar 使用 `pnpm-workspace.yaml`（`nodeLinker: hoisted` + `patchedDependencies`），
> 不是 npm。registry 走官方源（`sidecar/.npmrc`），Huawei 镜像存在版本滞后。

## 3. 审计自定义覆盖层（boot.ts overlays）

`sidecar/src/boot.ts` 的 `overlays` 是我们对基线组合的全部自定义，升级时必须逐条核对：

| overlay | 作用 | 升级时要确认 |
|---|---|---|
| `webserver` | loopback 绑定 127.0.0.1 + 随机端口 | webserver 配置 schema 是否变化 |
| `llm-deepseek` | 挂载 `dsh-llm-deepseek` 提供方适配器（base 不挂） | 包名/注册方式是否变化 |
| `agent-presets` | 注入 shipped preset 根（`@deepseek-ai/dsh/config/agent-presets`） | `$DSH_HOME`/presets 路径约定是否变化 |

以及 `healProfilesModuleFallback`、`resolveProfileDir`、`boot()` 的签名——用
`sidecar/node_modules/@deepseek-ai/*/lib/types/*.d.ts` 核对。

## 4. 复查补丁（sidecar/patches/）

`pnpm-workspace.yaml` 的 `patchedDependencies` 引用两个关键补丁：

- `dsh-sandbox-windows-acl`（`dwFlags: 257` + `wShowWindow: 0`，隐藏 sandbox 命令窗口）
- `dsh-llm-deepseek`（空 tool-call 不生成 `callId: undefined`）

补丁文件按版本号命名、目标为版本特有的 hashed 文件（如 `lib/types-CNjZgO4h.js`）。
升级后若 `pnpm install` 报 patch 不匹配：

```bash
cd sidecar
pnpm patch @deepseek-ai/dsh-sandbox-windows-acl@<新版本>   # 手动重打
# 或从 desktop 仓库重取：https://github.com/anywhere-labs/deepseek-harness-desktop/tree/master/patches/
```

## 5. 验证补丁生效

```bash
grep -n "dwFlags: 257" node_modules/@deepseek-ai/dsh-sandbox-windows-acl/lib/*.js
grep -n "if (call.id)"  node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js
```

## 6. 重建与打包

```bash
npm run sidecar:bundle    # 编译 sidecar + 组装生产闭包 + 捆绑 Node 22 运行时
npm run tauri build       # 产出 NSIS 安装包（target: nsis）
```

产物：`src-tauri/target/release/bundle/nsis/DeepSeek Harness_<版本>_x64-setup.exe`

## 7. 端到端验证（发布前必做）

1. **全新安装**到临时目录，双击/静默安装：
   ```bash
   "./DeepSeek Harness_x64-setup.exe" /S "/D=D:\dsh-verify"
   ```
2. 启动后确认：sidecar 解压到 `%APPDATA%/<identifier>/sidecar`（含 dist/node_modules），
   内置 node 跑起引擎，官方 dsh web UI 在 loopback 端口服务。
3. 配置模型凭据 → 发真实 prompt → 验证模型回复、审批卡片、工作区沙箱。
4. 清理验证安装目录。

## 8. 已知注意点

- **孤儿进程防护**：Rust 宿主已用 Windows Job Object（`KILL_ON_JOB_CLOSE`）绑定 sidecar，
  宿主被强杀时 OS 自动回收；Node sidecar 另有 stdin 看门狗（管道断开自退）双保险。
  开发期仍可能遗留 `pnpm install`/`tauri dev` 的卡死进程，发布机打包前清理一次即可。
- **安装器展开**：Sidecar 生产闭包由安装器写入只读资源目录，Rust 宿主直接原地运行，避免首启解压。
- **MSI 目标不可用**：sidecar 3.2 万+ 文件导致 WiX 卡死，故 `tauri.conf.json` `targets: "nsis"`，
  不要改回 `all`。发布流水线必须验证安装后的 Sidecar 关键入口，防止资源映射遗漏海量依赖文件。
