/**
 * @fileoverview 内置基础工具插件 (Layer 1 - Builtin)
 * @description 官方 DeepSeek Harness 基准只读与执行工具集，集成 Workspace Jail 沙箱防护与 Approval Gate 审批门禁。
 */

import { Context } from "cordis";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { WorkspaceJail } from "../../security/workspace-jail.js";
import { ApprovalGate } from "../../security/approval-gate.js";

const execAsync = promisify(exec);

export interface BaseToolsOptions {
  jail?: WorkspaceJail;
  approvalGate?: ApprovalGate;
}

/**
 * 官方基线核心工具插件
 *
 * @param ctx - Cordis 上下文
 * @param options - 沙箱与审批门禁配置
 */
export function BaseToolsPlugin(ctx: Context, options?: BaseToolsOptions): void {
  const jail = options?.jail || new WorkspaceJail();
  const approvalGate = options?.approvalGate;

  // 1. 文件读取工具 (受 Workspace Jail 约束)
  ctx.toolRegistry.registerTool({
    name: "read_file",
    description: "读取指定路径的文件文本内容 (受工作区沙箱约束)",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "待读取的文件路径" },
      },
      required: ["path"],
    },
    execute: async ({ path: filePath }: { path: string }) => {
      const safePath = jail.resolveSafePath(filePath);
      const content = await fs.readFile(safePath, "utf-8");
      return { content, safePath };
    },
  });

  // 2. 文件写入工具 (受 Workspace Jail 约束)
  ctx.toolRegistry.registerTool({
    name: "write_file",
    description: "向指定路径写入文件内容 (受工作区沙箱约束)",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "目标文件路径" },
        content: { type: "string", description: "待写入的文本内容" },
      },
      required: ["path", "content"],
    },
    execute: async ({ path: filePath, content }: { path: string; content: string }) => {
      const safePath = jail.resolveSafePath(filePath);
      await fs.mkdir(path.dirname(safePath), { recursive: true });
      await fs.writeFile(safePath, content, "utf-8");
      return { success: true, safePath };
    },
  });

  // 3. 目录列表工具 (受 Workspace Jail 约束)
  ctx.toolRegistry.registerTool({
    name: "list_dir",
    description: "列出指定目录下的所有子文件与子目录 (受工作区沙箱约束)",
    parameters: {
      type: "object",
      properties: {
        dir: { type: "string", description: "目录路径" },
      },
      required: ["dir"],
    },
    execute: async ({ dir }: { dir: string }) => {
      const safeDir = jail.resolveSafePath(dir);
      const entries = await fs.readdir(safeDir, { withFileTypes: true });
      return {
        entries: entries.map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory(),
        })),
        safeDir,
      };
    },
  });

  // 4. 命令执行工具 (受 Approval Gate 审批门禁拦截)
  ctx.toolRegistry.registerTool({
    name: "run_command",
    description: "在当前工作区执行 Shell 指令 (触发安全审批门禁)",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "待执行的命令字符串" },
        cwd: { type: "string", description: "工作目录" },
      },
      required: ["command"],
    },
    execute: async ({ command, cwd }: { command: string; cwd?: string }) => {
      // 触发安全审批拦截
      if (approvalGate) {
        const approved = await approvalGate.requestApproval(
          "shell_command",
          `Agent 请求执行系统命令: "${command}"`,
          { command, cwd: cwd || jail.getRootDir() },
          "high"
        );
        if (!approved) {
          throw new Error(`[Security Gate] Command execution rejected by user: "${command}"`);
        }
      }

      const targetCwd = cwd ? jail.resolveSafePath(cwd) : jail.getRootDir();
      const { stdout, stderr } = await execAsync(command, { cwd: targetCwd });
      return { stdout, stderr };
    },
  });
}
