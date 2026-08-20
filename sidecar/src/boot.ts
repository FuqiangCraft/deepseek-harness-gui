/**
 * @fileoverview Sidecar 官方 DSH Web Host 启动器
 * @description 以库方式 boot() 官方 @deepseek-ai/dsh 引擎（web profile: dsh-base + dsh-web-app），
 * 将 webserver 绑定到 127.0.0.1:0（loopback + OS 分配端口），就绪后向 stdout 输出
 * `DSH_PORT=<port>` 供 Rust 宿主读取并导航 webview 加载官方 dsh web UI。
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { createRequire } from "node:module";
import type { Context } from "@deepseek-ai/cordis";
// 副作用类型导入：加载 @deepseek-ai/dsh-host-webserver 的 Context 模块增强（webServer 服务）
import type { WebServer } from "@deepseek-ai/dsh-host-webserver";
// 副作用类型导入：加载 @deepseek-ai/dsh-tools 的 Context 模块增强（tools 服务）
import type { ToolRuntime } from "@deepseek-ai/dsh-tools";
import {
  boot,
  healProfilesModuleFallback,
  initProfile,
  installFailLoud,
  loadLayeredEnv,
  loadProfile,
  PROFILE_TEMPLATES,
  resolveProfileDir,
} from "@deepseek-ai/dsh-app-boot";
import { provideCmdline } from "@deepseek-ai/dsh-cmdline";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { DSH_LAUNCH_ENVIRONMENT_KEY } from "@deepseek-ai/dsh-launch-environment";

/** 诊断前缀（binName），用于 boot 失败错误信息。 */
const BIN_NAME = "harness-sidecar";
/** 使用的官方 profile 模板（web = dsh-base + dsh-web-app）。 */
const PROFILE_NAME = "web";
/** Loader 的第一个解析锚点：本包 package.json（其 node_modules 含全部 dsh 包）。 */
const INSTALL_ANCHOR = fileURLToPath(new URL("../package.json", import.meta.url));
/** 宿主为本次启动分配的关联标识。 */
const RUN_ID = process.env.HARNESS_RUN_ID || "unknown";

/** 将普通诊断写入 stderr，确保 stdout 只承载宿主控制协议。 */
function logDiagnostic(level: "info" | "error", message: string, detail?: unknown): void {
  const record = JSON.stringify({ component: "sidecar", run_id: RUN_ID, level, message, detail });
  process.stderr.write(`${record}\n`);
}

/** 将未知异常格式化为保留 cause 链和 stack 的安全诊断对象。 */
function formatError(error: unknown): object {
  const chain: Array<{ name: string; message: string; stack?: string }> = [];
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      chain.push({ name: current.name, message: current.message, stack: current.stack });
      current = (current as Error & { cause?: unknown }).cause;
    } else {
      chain.push({ name: "UnknownError", message: String(current) });
      break;
    }
  }
  if (error instanceof AggregateError) {
    return { chain, aggregate: error.errors.map((item) => item instanceof Error ? { name: item.name, message: item.message, stack: item.stack } : String(item)) };
  }
  return { chain };
}

/**
 * 在 profile 目录内准备空根配置 `cordis.yml`（内容 `[]`），
 * 并将官方 web bundle 的补丁层合成进 patches 数组，最后覆盖
 * webserver 行为 loopback + 随机端口。
 */
async function prepareWebProfile() {
  const home = resolveDshHome();
  const profileDir = resolveProfileDir(PROFILE_NAME, home);
  const bundles = PROFILE_TEMPLATES.web ?? PROFILE_TEMPLATES.headless;

  // 首次使用自动初始化 profile 目录（幂等，不覆盖已有文件）
  initProfile(profileDir, bundles);

  // 维护 $DSH_HOME/profiles/node_modules 扁平回退层，使 profile 能解析本安装闭包内的全部 dsh 包
  healProfilesModuleFallback(INSTALL_ANCHOR, home);

  const profile = loadProfile(BIN_NAME, PROFILE_NAME, INSTALL_ANCHOR, home);
  const bundlePatches = profile.layers.flatMap((layer) => layer.patches);

  // 空根配置：全部插件由 patches 数组注入
  const rootConfig = path.join(profileDir, "cordis.yml");
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(rootConfig, "[]\n", "utf-8");

  // Loopback-only 绑定是启动器安全不变量，不是用户配置（与 desktop 一致）。
  // llm-deepseek 适配器：base profile 未挂载，需在此挂载以注册 deepseek-official 提供方路由；
  // 其密钥/端点由 settings.yaml 的 `llm-deepseek:` 段落与凭据 seam 提供。
  // agent-presets shipped root：`@deepseek-ai/dsh` 包随附 standard/minimal 等预设目录，
  // CLI 的 composeProfile 会把该目录作为 system trust 根补进 agent-presets 配置，
  // 库方式嵌入不跑 CLI，需在此补上，否则默认预设 `standard` 解析失败。
  const require = createRequire(import.meta.url);
  const shippedPresetRoot = path.join(
    path.dirname(require.resolve("@deepseek-ai/dsh/package.json")),
    "config",
    "agent-presets",
  );
  const overlays = [
    {
      id: "webserver",
      disabled: false,
      config: { host: "127.0.0.1", port: 0 },
    },
    {
      id: "llm-deepseek",
      disabled: false,
      name: "@deepseek-ai/dsh-llm-deepseek",
    },
    {
      id: "agent-presets",
      config: {
        default: "standard",
        roots: [{ path: shippedPresetRoot, trust: "system" }],
      },
    },
  ];

  return {
    home,
    profileDir,
    rootConfig,
    patches: structuredClone([...bundlePatches, ...profile.patches, ...overlays]),
    bareModuleBaseUrl: pathToFileURL(path.join(profileDir, "package.json")).href,
  };
}

/**
 * 优雅退出：先 dispose 引擎插件树，再退出进程。
 */
function requestExit(ctx: Context | null, code: number): void {
  void (async () => {
    if (ctx) {
      try {
        await ctx.fiber.dispose();
      } catch {
        // dispose 失败不阻塞退出
      }
    }
    process.exit(code);
  })();
}

async function main() {
  installFailLoud(BIN_NAME);

  const profileStarted = performance.now();
  const prepared = await prepareWebProfile();
  logDiagnostic("info", "phase_complete", { phase: "profile_initialization", duration_ms: Math.round(performance.now() - profileStarted) });
  let ctx: Context | null = null;

  const pluginsStarted = performance.now();
  ctx = await boot(
    BIN_NAME,
    prepared.rootConfig,
    prepared.patches,
    async (hostCtx) => {
      hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, loadLayeredEnv(BIN_NAME));
      provideCmdline(hostCtx, {
        args: [],
        exit: (code) => requestExit(ctx, code),
      });
    },
    prepared.bareModuleBaseUrl,
  );
  logDiagnostic("info", "phase_complete", { phase: "plugin_tree_loading", duration_ms: Math.round(performance.now() - pluginsStarted) });

  // 插件树已 settle（assertEntriesActivated 通过），webserver 已监听
  const port = ctx.webServer.port;
  logDiagnostic("info", "web_server_ready", { phase: "web_server_ready", port });
  console.log(`DSH_PORT=${port}`);

  // 打印已注册工具清单（含企业插件贡献），便于诊断工具注册
  try {
    const toolNames = ctx.tools.schemas().map((t) => t.name);
    logDiagnostic("info", "registered_tools", { count: toolNames.length, names: toolNames });
  } catch {
    // 工具服务未就绪时跳过该日志，不影响启动
  }

  process.on("SIGINT", () => requestExit(ctx, 0));
  process.on("SIGTERM", () => requestExit(ctx, 0));

  // stdin 看门狗：sidecar 经 stdin/stdout 管道与宿主通信，宿主进程退出
  // （含被强杀、崩溃）时管道断开，这里自动退出，与 Rust 侧 Job Object 双保险防孤儿。
  process.stdin.resume();
  process.stdin.on("end", () => process.exit(0));
  process.stdin.on("close", () => process.exit(0));
}

process.on("uncaughtException", (error) => {
  logDiagnostic("error", "uncaught_exception", formatError(error));
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logDiagnostic("error", "unhandled_rejection", formatError(reason));
  process.exit(1);
});

main().catch((err: unknown) => {
  logDiagnostic("error", "sidecar_boot_failed", formatError(err));
  process.exit(1);
});
