/**
 * @fileoverview DeepSeek Harness Sidecar 运行时主入口
 * @description 初始化 Cordis 微内核全局上下文，挂载双层插件加载器、沙箱安全防护、审批门禁、会话管理器与配置同步器，启动 Stdio JSON-RPC 调度服务。
 */

import { RpcServer } from "./rpc.js";
import { handlePing } from "./handlers/ping.js";
import { createAgentContext } from "./core/context.js";
import { PluginLoader } from "./core/plugin-loader.js";
import { registerPluginHandlers } from "./handlers/plugins.js";
import { SessionManager } from "./session/session-manager.js";
import { registerSessionHandlers } from "./handlers/session.js";
import { DiffManager } from "./diff/diff-manager.js";
import { registerDiffHandlers } from "./handlers/diff.js";
import { WorkspaceJail } from "./security/workspace-jail.js";
import { ApprovalGate } from "./security/approval-gate.js";
import { registerApprovalHandlers } from "./handlers/approval.js";
import { ConfigSyncManager } from "./sync/config-sync.js";
import { registerConfigHandlers } from "./handlers/config.js";

async function bootstrap() {
  const server = new RpcServer();

  // 1. 初始化安全防护与审批门禁 (Workspace Jail & Approval Gate)
  const workspaceDir = process.cwd();
  const jail = new WorkspaceJail(workspaceDir);
  const approvalGate = new ApprovalGate(server);
  const configSync = new ConfigSyncManager();

  // 2. 初始化 Cordis 微内核上下文与核心管理器
  const ctx = createAgentContext();
  const pluginLoader = new PluginLoader(ctx, jail, approvalGate);
  const sessionManager = new SessionManager(ctx, server);
  const diffManager = new DiffManager(server);

  // 3. 初始化双层插件系统（加载内置基线与动态插件目录）
  await pluginLoader.initialize(workspaceDir);

  // 4. 注册系统级 RPC 方法
  server.register("system.ping", async () => {
    return handlePing();
  });

  server.register("system.shutdown", async () => {
    setTimeout(() => {
      server.stop();
      process.exit(0);
    }, 50);
    return { status: "shutting_down" };
  });

  // 5. 注册插件与工具能力查询 RPC
  registerPluginHandlers(ctx, pluginLoader, (m, h) => server.register(m, h));

  // 6. 注册 Agent 会话交互 RPC
  registerSessionHandlers(sessionManager, (m, h) => server.register(m, h));

  // 7. 注册代码差异与审查 RPC
  registerDiffHandlers(diffManager, (m, h) => server.register(m, h));

  // 8. 注册审批门禁 RPC
  registerApprovalHandlers(approvalGate, (m, h) => server.register(m, h));

  // 9. 注册企业配置同步 RPC
  registerConfigHandlers(configSync, (m, h) => server.register(m, h));

  // 10. 启动 Stdio 监听
  server.start();

  // 11. 推送启动就绪事件通知
  const activePlugins = pluginLoader.listPlugins();
  const activeTools = ctx.toolRegistry.listTools();

  server.notify("system.ready", {
    pid: process.pid,
    version: "0.1.0",
    pluginCount: activePlugins.length,
    toolCount: activeTools.length,
    workspace: jail.getRootDir(),
  });
}

bootstrap().catch((err) => {
  console.error("[Sidecar Bootstrap Error]", err);
  process.exit(1);
});
